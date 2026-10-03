"""Neon Postgres: the shared record between the daily run and your PC.

Without it, each side only sees its own files: the daily run's shortlist
reaches you as an emailed PDF, `apply.py` needs a local search first, and
outcomes you record on your PC never reach the Feedback Analyst in CI. With
it, both sides read and write the same tables:

- ``runs`` / ``jobs`` / ``shortlist``: every run's shortlist with its scores,
  tailored resume selection, cover note and fact-check results.
- ``outcomes``: what happened on each job (applied, interview, ...).
- ``applications``: every Applicant attempt and how it ended.
- ``memories``: copies of the ATS and career memories, so a cold Actions
  cache or a fresh PC starts from what earlier runs learned.

The connection string comes only from the ``DATABASE_URL`` environment
variable (GitHub secret in CI, gitignored ``.env`` locally) and is never
logged. Every call is best-effort: with no URL, no driver, or no network the
store reports itself unavailable and the pipeline carries on exactly as it
did before the database existed.
"""
import json
import os
from datetime import datetime, timezone
from typing import Optional

SCHEMA = (
    """create table if not exists runs (
        id bigserial primary key,
        created_at timestamptz not null default now(),
        discovered integer not null default 0,
        shortlisted integer not null default 0,
        new_jobs integer not null default 0,
        remote_jobs integer not null default 0
    )""",
    """create table if not exists jobs (
        job_id text primary key,
        title text not null,
        company text not null,
        location text,
        url text,
        source text,
        site text,
        work_mode text,
        description text,
        posted_date text,
        first_seen timestamptz not null default now(),
        last_seen timestamptz not null default now()
    )""",
    """create table if not exists shortlist (
        run_id bigint not null references runs(id) on delete cascade,
        job_id text not null references jobs(job_id),
        rank integer not null,
        match_score real not null,
        match_reasons jsonb,
        is_new boolean not null default false,
        draft_resume jsonb,
        resume_review jsonb,
        cover_note text,
        cover_review jsonb,
        qa jsonb,
        fit_gap jsonb,
        primary key (run_id, job_id)
    )""",
    """create table if not exists outcomes (
        id bigserial primary key,
        job_id text not null,
        company text,
        title text,
        decision text not null,
        note text,
        recorded_at timestamptz not null,
        unique (job_id, decision, recorded_at)
    )""",
    """create table if not exists applications (
        id bigserial primary key,
        job_id text not null,
        platform text,
        status text not null,
        detail text,
        blockers jsonb,
        at timestamptz not null
    )""",
    """create table if not exists approvals (
        job_id text primary key,
        scope text not null,
        content_hash text not null,
        approver text,
        approved_at timestamptz not null,
        expires_at timestamptz not null,
        consumed_at timestamptz,
        result text
    )""",
    """create table if not exists memories (
        name text primary key,
        data jsonb not null,
        updated_at timestamptz not null default now()
    )""",
)


class Store:
    def __init__(self, conn):
        self.conn = conn

    # ---------- lifecycle ----------

    @classmethod
    def open(cls, url: Optional[str] = None, quiet: bool = False) -> Optional["Store"]:
        """A connected store, or None (with a one-line reason) if unavailable."""
        url = url or os.environ.get("DATABASE_URL", "")
        if not url:
            return None
        try:
            import psycopg
        except ImportError:
            if not quiet:
                print("  [store] psycopg not installed -- pip install -r requirements.txt")
            return None
        try:
            conn = psycopg.connect(url, connect_timeout=15, autocommit=True)
        except Exception as error:  # never echo the message: it can contain connection details
            if not quiet:
                print(f"  [store] database unavailable ({type(error).__name__}); continuing without it")
            return None
        store = cls(conn)
        store.ensure_schema()
        return store

    def close(self) -> None:
        try:
            self.conn.close()
        except Exception:
            pass

    def ensure_schema(self) -> None:
        with self.conn.transaction():
            for statement in SCHEMA:
                self.conn.execute(statement)

    @staticmethod
    def _json(value):
        from psycopg.types.json import Jsonb
        return Jsonb(value) if value is not None else None

    # ---------- runs and shortlists ----------

    def save_run(self, shortlist: list, discovered: int) -> int:
        """One run and its whole shortlist, in a single transaction."""
        new_jobs = sum(bool(job.is_new) for job in shortlist)
        remote = sum((job.work_mode or "").startswith("remote") for job in shortlist)
        with self.conn.transaction():
            run_id = self.conn.execute(
                "insert into runs (discovered, shortlisted, new_jobs, remote_jobs) values (%s, %s, %s, %s) returning id",
                (discovered, len(shortlist), new_jobs, remote),
            ).fetchone()[0]
            for rank, job in enumerate(shortlist, start=1):
                self.conn.execute(
                    """insert into jobs (job_id, title, company, location, url, source, site, work_mode, description, posted_date)
                       values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       on conflict (job_id) do update set
                         location = excluded.location, url = excluded.url, source = excluded.source,
                         site = excluded.site, work_mode = excluded.work_mode,
                         description = excluded.description, posted_date = excluded.posted_date,
                         last_seen = now()""",
                    (job.job_id, job.title, job.company, job.location, job.url, job.source, job.site,
                     job.work_mode, job.description, job.posted_date),
                )
                self.conn.execute(
                    """insert into shortlist (run_id, job_id, rank, match_score, match_reasons, is_new, draft_resume,
                                              resume_review, cover_note, cover_review, qa, fit_gap)
                       values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       on conflict (run_id, job_id) do nothing""",
                    (run_id, job.job_id, rank, job.match_score, self._json(job.match_reasons), bool(job.is_new),
                     self._json(job.draft_resume), self._json(job.resume_review), job.draft_cover_note,
                     self._json(job.cover_review), self._json(job.draft_qa), self._json(job.fit_gap)),
                )
        return run_id

    def latest_shortlist(self) -> tuple[Optional[int], Optional[datetime], list[dict]]:
        """The newest run's shortlist as job dicts (the report JSON shape)."""
        row = self.conn.execute("select id, created_at from runs where shortlisted > 0 order by id desc limit 1").fetchone()
        if not row:
            return None, None, []
        run_id, created_at = row
        rows = self.conn.execute(
            """select j.title, j.company, j.location, j.url, j.source, j.description, j.posted_date, s.match_score,
                      s.match_reasons, s.draft_resume, s.resume_review, s.cover_note, s.qa, j.job_id, j.work_mode,
                      s.cover_review, s.fit_gap, s.is_new, j.site
               from shortlist s join jobs j using (job_id)
               where s.run_id = %s order by s.rank""",
            (run_id,),
        ).fetchall()
        return run_id, created_at, [job_dict(row) for row in rows]

    def job_index(self) -> dict:
        """job_id -> latest known record, for the Feedback Analyst."""
        rows = self.conn.execute(
            """select distinct on (s.job_id) s.job_id, s.match_score, j.source, j.company, j.title
               from shortlist s join jobs j using (job_id) order by s.job_id, s.run_id desc"""
        ).fetchall()
        return {r[0]: {"job_id": r[0], "match_score": r[1], "source": r[2], "company": r[3], "title": r[4]} for r in rows}

    # ---------- outcomes and applications ----------

    def add_outcome(self, outcome: dict) -> None:
        self.conn.execute(
            """insert into outcomes (job_id, company, title, decision, note, recorded_at)
               values (%s, %s, %s, %s, %s, %s) on conflict do nothing""",
            (outcome["job_id"], outcome.get("company"), outcome.get("title"), outcome["decision"],
             outcome.get("note", ""), outcome.get("recorded_at") or datetime.now(timezone.utc).isoformat()),
        )

    def outcomes(self) -> list[dict]:
        rows = self.conn.execute(
            "select job_id, company, title, decision, note, recorded_at from outcomes order by recorded_at"
        ).fetchall()
        return [
            {"job_id": r[0], "company": r[1], "title": r[2], "decision": r[3], "note": r[4],
             "recorded_at": r[5].isoformat(), "schema_version": 1}
            for r in rows
        ]

    def add_application(self, attempt: dict) -> None:
        self.conn.execute(
            "insert into applications (job_id, platform, status, detail, blockers, at) values (%s, %s, %s, %s, %s, %s)",
            (attempt["job_id"], attempt.get("platform"), attempt["status"], attempt.get("detail", ""),
             self._json(attempt.get("blockers") or []), attempt.get("at") or datetime.now(timezone.utc).isoformat()),
        )

    # ---------- approvals (from the digest email's buttons) ----------

    def upsert_approval(self, record: dict) -> bool:
        """Store a decision; a newer click replaces an older one. Returns True if new."""
        row = self.conn.execute(
            """insert into approvals (job_id, scope, content_hash, approver, approved_at, expires_at)
               values (%s, %s, %s, %s, %s, %s)
               on conflict (job_id) do update set
                 scope = excluded.scope, content_hash = excluded.content_hash, approver = excluded.approver,
                 approved_at = excluded.approved_at, expires_at = excluded.expires_at,
                 consumed_at = null, result = null
               where approvals.approved_at < excluded.approved_at
               returning job_id""",
            (record["job_id"], record["scope"], record["content_hash"], record.get("approver", "email link"),
             record["approved_at"], record["expires_at"]),
        ).fetchone()
        return row is not None

    def pending_approvals(self) -> list[dict]:
        """Unused, unexpired submit/fill approvals with the job they cover."""
        rows = self.conn.execute(
            """select a.job_id, a.scope, a.content_hash, a.approved_at, a.expires_at
               from approvals a
               where a.consumed_at is null and a.expires_at > now() and a.scope in ('submit', 'fill')
               order by a.approved_at"""
        ).fetchall()
        return [{"job_id": r[0], "scope": r[1], "content_hash": r[2], "approved_at": r[3].isoformat(),
                 "expires_at": r[4].isoformat()} for r in rows]

    def mark_approval_used(self, job_id: str, result: str) -> None:
        self.conn.execute("update approvals set consumed_at = now(), result = %s where job_id = %s", (result, job_id))

    def decided_job_ids(self) -> set:
        """Jobs you've already approved or skipped -- never ask about them again."""
        return {r[0] for r in self.conn.execute("select job_id from approvals").fetchall()}

    def latest_job(self, job_id: str) -> Optional[dict]:
        row = self.conn.execute(
            """select j.title, j.company, j.location, j.url, j.source, j.description, j.posted_date, s.match_score,
                      s.match_reasons, s.draft_resume, s.resume_review, s.cover_note, s.qa, j.job_id, j.work_mode,
                      s.cover_review, s.fit_gap, s.is_new, j.site
               from shortlist s join jobs j using (job_id)
               where s.job_id = %s order by (s.draft_resume is not null) desc, s.run_id desc limit 1""",
            (job_id,),
        ).fetchone()
        return job_dict(row) if row else None

    # ---------- what the agents learn from ----------

    def previous_drafts(self) -> dict:
        """job_id -> the newest cover note that passed the fact check, so the
        Application Writer reuses it instead of asking the model again."""
        rows = self.conn.execute(
            """select distinct on (job_id) job_id, cover_note, qa, cover_review
               from shortlist
               where cover_note is not null and cover_note not like '[Drafting failed%%'
                 and coalesce((cover_review->>'passed')::boolean, false)
               order by job_id, run_id desc"""
        ).fetchall()
        return {r[0]: {"cover_note": r[1], "qa": r[2] or [], "cover_review": r[3]} for r in rows}

    def resume_plans(self) -> dict:
        """job_id -> the newest tailored resume selection used for it."""
        rows = self.conn.execute(
            """select distinct on (job_id) job_id, draft_resume from shortlist
               where draft_resume is not null order by job_id, run_id desc"""
        ).fetchall()
        return {r[0]: r[1] for r in rows}

    # ---------- memories ----------

    def save_memory(self, name: str, data: dict) -> None:
        self.conn.execute(
            """insert into memories (name, data) values (%s, %s)
               on conflict (name) do update set data = excluded.data, updated_at = now()""",
            (name, self._json(data)),
        )

    def load_memory(self, name: str) -> Optional[dict]:
        row = self.conn.execute("select data from memories where name = %s", (name,)).fetchone()
        return row[0] if row else None

    def counts(self) -> dict:
        return {
            table: self.conn.execute(f"select count(*) from {table}").fetchone()[0]
            for table in ("runs", "jobs", "shortlist", "outcomes", "applications", "approvals", "memories")
        }


JOB_COLUMNS = (
    "title", "company", "location", "url", "source", "description", "posted_date", "match_score",
    "match_reasons", "draft_resume", "resume_review", "draft_cover_note", "draft_qa", "job_id", "work_mode",
    "cover_review", "fit_gap", "is_new", "site",
)


def job_dict(row) -> dict:
    """A shortlist row in the same shape as a report_*.json entry."""
    data = dict(zip(JOB_COLUMNS, row))
    data["match_reasons"] = data["match_reasons"] or []
    data["draft_qa"] = data["draft_qa"] or []
    data["match_score"] = float(data["match_score"] or 0)
    return data


def restore_memory_file(store: Optional["Store"], name: str, path: str) -> bool:
    """Seed a missing local memory file from the database copy."""
    if store is None or os.path.exists(path):
        return False
    data = store.load_memory(name)
    if not data:
        return False
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
    return True


def save_memory_file(store: Optional["Store"], name: str, path: str) -> None:
    if store is None or not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        store.save_memory(name, json.load(f))


def push(kind: str, record: dict) -> None:
    """Best-effort one-off write from the CLI tools (outcomes, attempts)."""
    store = Store.open(quiet=True)
    if store is None:
        return
    try:
        if kind == "outcome":
            store.add_outcome(record)
        elif kind == "application":
            store.add_application(record)
    except Exception:
        pass
    finally:
        store.close()

"""Append-only, local-only record of what actually happened on jobs the
agent shortlisted -- did you apply, hear back, get an interview, get an
offer? This is the data Feedback Analyst needs and the system has no way
to collect automatically, since the agent never submits anything.

Recording an outcome is a manual, explicit act by the user (see
``record_outcome.py``), never inferred or scraped. The file lives under the
gitignored ``output/`` directory alongside everything else private to a run
-- it is never committed and never leaves the machine on its own.
"""
import json
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Optional

SCHEMA_VERSION = 1
DECISIONS = ("applied", "skipped", "interview", "rejected", "offer", "no_response")
OUTCOMES_FILENAME = "outcomes.jsonl"


@dataclass
class Outcome:
    job_id: str
    company: str
    title: str
    decision: str
    note: str = ""
    recorded_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    schema_version: int = SCHEMA_VERSION


def _path(output_dir: str) -> str:
    return os.path.join(output_dir, OUTCOMES_FILENAME)


def record_outcome(
    output_dir: str,
    job_id: str,
    company: str,
    title: str,
    decision: str,
    note: str = "",
) -> Outcome:
    if decision not in DECISIONS:
        raise ValueError(f"decision must be one of {DECISIONS}, got {decision!r}")
    if not job_id:
        raise ValueError("job_id is required -- find it in the latest report_*.json")

    outcome = Outcome(job_id=job_id, company=company, title=title, decision=decision, note=note)
    os.makedirs(output_dir, exist_ok=True)
    with open(_path(output_dir), "a", encoding="utf-8") as f:
        f.write(json.dumps(asdict(outcome), ensure_ascii=False) + "\n")
    # Best-effort copy to the shared database so the daily run sees it too.
    from .store import push
    push("outcome", asdict(outcome))
    return outcome


def load_outcomes(output_dir: str) -> list[dict]:
    path = _path(output_dir)
    if not os.path.exists(path):
        return []
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # skip a corrupted line rather than fail the whole load
    return records


def find_job_by_id(reports_dir: str, job_id: str) -> Optional[dict]:
    """Best-effort lookup of a job's company/title from the most recent
    report_*.json files, newest first, so the CLI can be used with just an
    id. Returns None if not found (the user can still pass --company/--title
    directly)."""
    if not os.path.isdir(reports_dir):
        return None
    report_files = sorted(
        (f for f in os.listdir(reports_dir) if f.startswith("report_") and f.endswith(".json")),
        reverse=True,
    )
    for filename in report_files:
        try:
            with open(os.path.join(reports_dir, filename), encoding="utf-8") as f:
                jobs = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        for job in jobs:
            if job.get("job_id") == job_id:
                return job
    return None

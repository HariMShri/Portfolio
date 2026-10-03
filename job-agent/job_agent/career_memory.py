"""What the agent has learned about where jobs come from, kept between runs.

The ATS memory remembers *what* employers ask for; this remembers *where* to
look and what happened there, so each run spends its time on sites that work:

- **Sites**: per job board (Greenhouse token, Workday site, ...): last
  status, consecutive failures, listings and shortlisted jobs it has produced.
  A board that 404s twice is parked for a week; one that needs a login is
  parked for a month and its jobs are routed to the user. Productive boards
  are listed in the run log so dead weight is visible.
- **Resolutions**: which ATS a company careers page uses, so the page is only
  re-inspected every 30 days instead of every run.
- **Seen jobs**: the stable job ID and the date it was first seen, so the
  report can mark today's genuinely new jobs. IDs are hashes of company and
  title, never the listing itself.
- **Apply routes**: per platform, whether the Applicant can submit there or
  the user has to (login-only portals), learned from what actually happened.

Only board identifiers that are already in config.json, hashes, dates and
counts are stored. The file is gitignored and, in CI, lives in the Actions
cache -- the same arrangement as the ATS memory.
"""
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

SCHEMA_VERSION = 1
MEMORY_FILENAME = "career_memory.json"
PARK_FOR = {
    "dead": timedelta(days=7),
    "blocked": timedelta(days=3),
    "error": timedelta(days=1),
    "login_required": timedelta(days=30),
    "unsupported": timedelta(days=30),
}
FAILURES_BEFORE_PARKING = 2
RESOLUTION_TTL = timedelta(days=30)
SEEN_TTL = timedelta(days=45)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _path(output_dir: str) -> str:
    return os.path.join(output_dir, MEMORY_FILENAME)


def empty_memory() -> dict:
    return {"schema_version": SCHEMA_VERSION, "sites": {}, "resolutions": {}, "seen": {}, "apply_routes": {}, "runs": 0}


def load(output_dir: str) -> dict:
    try:
        with open(_path(output_dir), encoding="utf-8") as f:
            memory = json.load(f)
    except (OSError, ValueError):
        return empty_memory()
    if memory.get("schema_version") != SCHEMA_VERSION:
        return empty_memory()
    for key, value in empty_memory().items():
        memory.setdefault(key, value)
    return memory


def save(output_dir: str, memory: dict) -> str:
    os.makedirs(output_dir, exist_ok=True)
    with open(_path(output_dir), "w", encoding="utf-8") as f:
        json.dump(memory, f, indent=2, sort_keys=True)
    return _path(output_dir)


def site_key(platform: str, token: str) -> str:
    return f"{platform}:{token}"


# ---------- sites ----------

def parked(memory: dict, key: str, now: Optional[datetime] = None) -> Optional[str]:
    """Why this site is being skipped this run, or None to visit it."""
    site = memory["sites"].get(key)
    if not site or not site.get("skip_until"):
        return None
    if datetime.fromisoformat(site["skip_until"]) > (now or _now()):
        return f"{site.get('status')} (retry after {site['skip_until'][:10]})"
    return None


def record_visit(memory: dict, key: str, status: str, jobs: int, now: Optional[datetime] = None) -> dict:
    now = now or _now()
    site = memory["sites"].setdefault(key, {
        "visits": 0, "failures": 0, "jobs_total": 0, "shortlisted_total": 0, "status": "",
    })
    site["visits"] += 1
    site["status"] = status
    site["last_visit"] = now.isoformat()
    site["last_jobs"] = jobs
    site.pop("skip_until", None)
    if status in ("ok", "empty"):
        site["failures"] = 0
        site["jobs_total"] += jobs
    else:
        site["failures"] += 1
        # Logins and unsupported pages don't fix themselves on a retry.
        immediate = status in ("login_required", "unsupported")
        if immediate or site["failures"] >= FAILURES_BEFORE_PARKING:
            site["skip_until"] = (now + PARK_FOR.get(status, timedelta(days=1))).isoformat()
    return site


def record_shortlisted(memory: dict, shortlist: list) -> None:
    for job in shortlist:
        key = getattr(job, "site", "")
        if key and key in memory["sites"]:
            memory["sites"][key]["shortlisted_total"] += 1


def site_report(memory: dict) -> dict:
    """Counts-only summary for the run log: productive, empty and parked sites."""
    productive, idle, parked_sites = [], [], []
    for key, site in sorted(memory["sites"].items()):
        if site.get("skip_until"):
            parked_sites.append(f"{key} ({site.get('status')})")
        elif site.get("shortlisted_total"):
            productive.append((key, site["shortlisted_total"]))
        elif site.get("visits", 0) >= 3:
            idle.append(key)
    productive.sort(key=lambda item: -item[1])
    return {"productive": productive, "never_shortlisted": idle, "parked": parked_sites}


# ---------- careers-page resolutions ----------

def cached_resolution(memory: dict, url: str, now: Optional[datetime] = None) -> Optional[dict]:
    entry = memory["resolutions"].get(url)
    if not entry:
        return None
    if datetime.fromisoformat(entry["checked_at"]) + RESOLUTION_TTL < (now or _now()):
        return None
    return entry


def remember_resolution(memory: dict, url: str, resolution: dict, now: Optional[datetime] = None) -> None:
    memory["resolutions"][url] = {**resolution, "checked_at": (now or _now()).isoformat()}


# ---------- seen jobs ----------

def mark_new(memory: dict, jobs: list, now: Optional[datetime] = None) -> int:
    """Flag jobs not seen in an earlier run; returns how many are new."""
    now = now or _now()
    today = now.date().isoformat()
    seen = memory["seen"]
    new = 0
    for job in jobs:
        first = seen.get(job.job_id)
        job.is_new = first is None or first == today
        if first is None:
            seen[job.job_id] = today
            new += 1
    cutoff = (now - SEEN_TTL).date().isoformat()
    for job_id in [job_id for job_id, first in seen.items() if first < cutoff]:
        del seen[job_id]
    return new


# ---------- apply routes ----------

def learn_apply_route(memory: dict, platform: str, outcome: str) -> None:
    """Remember what applying on a platform actually needed."""
    route = memory["apply_routes"].setdefault(platform, {"submitted": 0, "needs_you": 0, "login_required": 0})
    if outcome in route:
        route[outcome] += 1


def apply_route(memory: dict, platform: str) -> str:
    """'login_required' once a platform has only ever asked for a login."""
    route = memory["apply_routes"].get(platform) or {}
    if route.get("login_required") and not route.get("submitted"):
        return "login_required"
    return "auto" if route.get("submitted") else "unknown"


def summarize(memory: dict) -> str:
    report = site_report(memory)
    return (
        f"{len(memory['sites'])} sites known, {len(report['parked'])} parked, "
        f"{len(memory['seen'])} jobs remembered, {memory.get('runs', 0)} run(s)"
    )

"""What the agents learn from the database instead of asking the AI.

Every run and every outcome is in Neon, so each agent can improve from
evidence rather than from more model calls:

- **Fit Analyst** -- ``source_calibration``: sources whose shortlisted jobs
  have led to interviews more often than average earn a small bonus, and
  sources that never do get a small penalty. Bounded to +/-5 points and only
  once a source has at least ``MIN_SAMPLE`` resolved outcomes, so a couple of
  lucky replies can't reshape the shortlist.
- **Resume Tailor** -- ``highlight_boosts``: resume bullets that were on the
  resume for jobs that led to an interview are nudged up when they're
  otherwise a close call. Only bullets from your profile are ever chosen;
  this changes order, never content.
- **Application Writer** -- ``reusable_drafts``: a job that already has a
  fact-checked cover note gets that note again instead of a new model call,
  and the day's drafting goes to jobs that don't have one yet.
- **Application Coordinator** -- ``decided``: jobs you've already approved
  or skipped are never offered for approval again.

All of it is counting over rows already stored; there's no model involved.
"""
from typing import Optional

MIN_SAMPLE = 5
MIN_POSITIVES_FOR_BOOSTS = 3
POSITIVE = {"interview", "offer"}
RESOLVED = {"interview", "offer", "rejected", "no_response"}
MAX_SOURCE_BONUS = 5


def source_calibration(outcomes: list[dict], job_index: dict, min_sample: int = MIN_SAMPLE) -> dict:
    """source -> score adjustment (-5..+5) from resolved outcomes."""
    per_source: dict[str, list[int]] = {}
    for outcome in outcomes:
        if outcome.get("decision") not in RESOLVED:
            continue
        source = (job_index.get(outcome.get("job_id")) or {}).get("source")
        if not source:
            continue
        resolved_positive = per_source.setdefault(source, [0, 0])
        resolved_positive[0] += 1
        resolved_positive[1] += outcome["decision"] in POSITIVE
    total = sum(n for n, _ in per_source.values())
    if total < min_sample:
        return {}
    overall = sum(p for _, p in per_source.values()) / total
    calibration = {}
    for source, (resolved, positive) in per_source.items():
        if resolved < min_sample:
            continue
        rate = positive / resolved
        bonus = round((rate - overall) * 20)
        calibration[source] = max(-MAX_SOURCE_BONUS, min(MAX_SOURCE_BONUS, bonus))
    return {source: bonus for source, bonus in calibration.items() if bonus}


def highlight_boosts(outcomes: list[dict], resume_plans: dict) -> dict:
    """(experience_index, highlight_index) -> small score bonus for bullets
    that were on resumes which led to interviews or offers."""
    positive_jobs = [o["job_id"] for o in outcomes if o.get("decision") in POSITIVE]
    if len(positive_jobs) < MIN_POSITIVES_FOR_BOOSTS:
        return {}
    counts: dict[tuple, int] = {}
    for job_id in positive_jobs:
        plan = resume_plans.get(job_id) or {}
        for entry in plan.get("experience", []):
            for highlight in entry.get("highlight_indices", []):
                key = (entry["experience_index"], highlight)
                counts[key] = counts.get(key, 0) + 1
    return {key: min(2.0, 0.75 * count) for key, count in counts.items()}


def reusable_drafts(previous: dict, jobs: list) -> dict:
    """job_id -> stored draft for the jobs in this run that already have one."""
    return {job.job_id: previous[job.job_id] for job in jobs if job.job_id in previous}


def load(store) -> dict:
    """Everything the agents learn from, in one round trip set. Empty when
    the database is unavailable, so every agent falls back to its defaults."""
    if store is None:
        return {"calibration": {}, "boosts": {}, "drafts": {}, "decided": set(), "outcomes": [], "index": {}}
    outcomes = store.outcomes()
    index = store.job_index()
    return {
        "calibration": source_calibration(outcomes, index),
        "boosts": highlight_boosts(outcomes, store.resume_plans()),
        "drafts": store.previous_drafts(),
        "decided": store.decided_job_ids(),
        "outcomes": outcomes,
        "index": index,
    }


def summarize(learned: dict) -> str:
    calibration = ", ".join(f"{s} {b:+d}" for s, b in sorted(learned["calibration"].items())) or "none yet"
    return (
        f"{len(learned['outcomes'])} outcomes; source calibration: {calibration}; "
        f"{len(learned['boosts'])} proven resume bullets; {len(learned['drafts'])} reusable cover notes; "
        f"{len(learned['decided'])} jobs already decided"
    )


def apply_calibration(job, calibration: Optional[dict]) -> None:
    """Fit Analyst hook: adjust a scored job by its source's track record."""
    if not calibration or job.match_score <= 0:
        return
    bonus = calibration.get(job.source, 0)
    if bonus:
        job.match_score = round(max(0.0, min(100.0, job.match_score + bonus)), 1)
        job.match_reasons.append(f"Past outcomes from {job.source}: {bonus:+d}")

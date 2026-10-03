"""Feedback Analyst: turns recorded outcomes (see ``outcomes.py``) into
*proposed* ranking adjustments for the user to review -- never an automatic
change to config.json or profile.json.

This agent was documented in WORKFLOW.md as planned-but-blocked: there was
no outcome data to learn from because the system never submits applications
and had no way to record what happened afterward. ``outcomes.py`` plus
``record_outcome.py`` close that gap; this module is the analysis step that
consumes it. Until enough outcomes exist, it says so plainly instead of
inventing a signal out of too little data -- a real constraint for a single
person's job search, not a placeholder.

Output is a dated, append-only proposal file under the run's output
directory (versioned by filename, never overwritten) so a rejected proposal
leaves no trace in config.json and a later run can be compared against it.
"""
import json
import os
from datetime import datetime
from typing import Optional

from .outcomes import load_outcomes

MIN_SAMPLE = 5
POSITIVE_DECISIONS = {"interview", "offer"}
RESOLVED_DECISIONS = {"interview", "offer", "rejected", "no_response"}
SCORE_BANDS = ((0, 50), (50, 65), (65, 80), (80, 101))


def _load_job_index(reports_dir: str) -> dict[str, dict]:
    """job_id -> most recent known record (match_score, source, ...) across
    every report this run directory has ever written, newest file wins."""
    index: dict[str, dict] = {}
    if not os.path.isdir(reports_dir):
        return index
    report_files = sorted(
        f for f in os.listdir(reports_dir) if f.startswith("report_") and f.endswith(".json")
    )
    for filename in report_files:  # oldest first so the final pass (newest) wins on conflicts
        try:
            with open(os.path.join(reports_dir, filename), encoding="utf-8") as f:
                jobs = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        for job in jobs:
            job_id = job.get("job_id")
            if job_id:
                index[job_id] = job
    return index


def _score_band(score: float) -> str:
    for low, high in SCORE_BANDS:
        if low <= score < high:
            return f"{low}-{high - 1}"
    return "unknown"


def analyze(output_dir: str, config: dict, extra_outcomes: Optional[list] = None,
            extra_index: Optional[dict] = None) -> dict:
    """Return a proposal dict. Never raises for ordinary "not enough data
    yet" conditions; a run with zero recorded outcomes gets a clean
    ``insufficient_data`` result, not an error."""
    outcomes = load_outcomes(output_dir)
    job_index = _load_job_index(output_dir)
    if extra_outcomes:
        # The database holds outcomes recorded on any machine; merge, de-duplicated.
        seen = {(o.get("job_id"), o.get("decision"), o.get("recorded_at")) for o in outcomes}
        outcomes += [o for o in extra_outcomes
                     if (o.get("job_id"), o.get("decision"), o.get("recorded_at")) not in seen]
    if extra_index:
        job_index = {**extra_index, **job_index}

    counts_by_decision: dict[str, int] = {}
    for outcome in outcomes:
        decision = outcome.get("decision", "unknown")
        counts_by_decision[decision] = counts_by_decision.get(decision, 0) + 1

    resolved = [o for o in outcomes if o.get("decision") in RESOLVED_DECISIONS]

    result = {
        "schema_version": 1,
        "generated_at": datetime.now().isoformat(),
        "outcomes_recorded": len(outcomes),
        "resolved_outcomes": len(resolved),
        "counts_by_decision": counts_by_decision,
        "proposals": [],
        "status": "ok",
    }

    if len(resolved) < MIN_SAMPLE:
        result["status"] = "insufficient_data"
        result["note"] = (
            f"Only {len(resolved)} resolved outcome(s) recorded "
            f"(need {MIN_SAMPLE}+ interview/offer/rejected/no_response records before "
            "proposing any ranking change). Keep recording outcomes with record_outcome.py."
        )
        return result

    overall_success_rate = sum(1 for o in resolved if o["decision"] in POSITIVE_DECISIONS) / len(resolved)
    result["overall_success_rate"] = round(overall_success_rate, 3)

    # Per-source signal -- only speak up where there's enough volume to mean something.
    by_source: dict[str, list[dict]] = {}
    for outcome in resolved:
        job = job_index.get(outcome["job_id"])
        if not job:
            continue
        by_source.setdefault(job.get("source", "unknown"), []).append(outcome)

    for source, source_outcomes in by_source.items():
        if len(source_outcomes) < MIN_SAMPLE:
            continue
        success_rate = sum(1 for o in source_outcomes if o["decision"] in POSITIVE_DECISIONS) / len(source_outcomes)
        if success_rate < overall_success_rate * 0.5:
            result["proposals"].append({
                "type": "source_deprioritize",
                "source": source,
                "sample_size": len(source_outcomes),
                "success_rate": round(success_rate, 3),
                "overall_success_rate": round(overall_success_rate, 3),
                "rationale": (
                    f"{source} jobs converted to interview/offer at {success_rate:.0%} "
                    f"over {len(source_outcomes)} resolved outcomes, well below the "
                    f"{overall_success_rate:.0%} overall rate. Consider removing or "
                    "deprioritizing this source in config.json -- review before changing."
                ),
            })

    # Score-band signal -- is the current min_match_score threshold doing its job?
    by_band: dict[str, list[dict]] = {}
    for outcome in resolved:
        job = job_index.get(outcome["job_id"])
        if not job:
            continue
        by_band.setdefault(_score_band(job.get("match_score", 0)), []).append(outcome)

    lowest_band = _score_band(config.get("min_match_score", 35))
    low_band_outcomes = by_band.get(lowest_band, [])
    if len(low_band_outcomes) >= MIN_SAMPLE:
        low_band_rate = sum(1 for o in low_band_outcomes if o["decision"] in POSITIVE_DECISIONS) / len(low_band_outcomes)
        if low_band_rate < overall_success_rate * 0.5:
            result["proposals"].append({
                "type": "raise_min_match_score",
                "current_min_match_score": config.get("min_match_score", 35),
                "band": lowest_band,
                "sample_size": len(low_band_outcomes),
                "success_rate": round(low_band_rate, 3),
                "overall_success_rate": round(overall_success_rate, 3),
                "rationale": (
                    f"Jobs scoring in the {lowest_band} band converted at {low_band_rate:.0%} "
                    f"over {len(low_band_outcomes)} resolved outcomes, well below the "
                    f"{overall_success_rate:.0%} overall rate. Consider raising min_match_score "
                    "in config.json -- review before changing."
                ),
            })

    if not result["proposals"]:
        result["note"] = "Enough data to analyze, but no source or score band stood out as underperforming yet."

    return result


def write_proposal(output_dir: str, result: dict) -> str:
    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(output_dir, f"feedback_proposal_{timestamp}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    return path


def run_feedback_analysis(output_dir: str, config: dict, extra_outcomes: Optional[list] = None,
                          extra_index: Optional[dict] = None) -> tuple[dict, Optional[str]]:
    """Best-effort entry point for main.py: analyze, write a dated proposal
    file, and report what happened. Never raises -- a feedback-analysis
    failure is a missed insight, not a failed job search."""
    try:
        result = analyze(output_dir, config, extra_outcomes, extra_index)
    except Exception as exc:
        print(f"  [feedback-analyst] analysis failed ({type(exc).__name__}); skipping this run")
        return {"status": "error"}, None

    if result["status"] == "insufficient_data":
        print(f"  [feedback-analyst] {result['note']}")
        return result, None

    path = write_proposal(output_dir, result)
    if result["proposals"]:
        print(f"  [feedback-analyst] {len(result['proposals'])} proposal(s) written to {path} -- review before applying")
    else:
        print(f"  [feedback-analyst] no proposals this run ({result.get('note', '')}) -- see {path}")
    return result, path

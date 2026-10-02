"""Job search agent: searches configured sources, scores matches against your
profile, selects resume evidence locally, drafts application materials with a
local model, and writes a local HTML report for you to review. It does not
submit anything anywhere -- you review each draft and apply manually on the
original listing.

Usage:
    python main.py
"""
import json

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # python-dotenv not installed -- RESEND_API_KEY must be set some other way

from job_agent.models import Job
from job_agent.matcher import score_and_filter
from job_agent.drafter import draft_shortlist
from job_agent.report import write_report
from job_agent.notifier import send_digest
from job_agent.resume_tailor import tailor_shortlist
from job_agent.reviewer import review_resume_drafts
from job_agent.feedback_analyst import run_feedback_analysis
from job_agent import ats_memory
from job_agent.local_llm import available_models, wait_until_ready
from job_agent.status import StatusPublisher
from job_agent.sources import greenhouse, lever, indeed, linkedin, naukri, manual


def load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def collect_jobs(config: dict) -> list[Job]:
    jobs: list[Job] = []

    print("Searching Greenhouse boards...")
    for board in config.get("greenhouse_boards", []):
        found = greenhouse.fetch(board)
        print(f"  [greenhouse:{board}] {len(found)} jobs")
        jobs.extend(found)

    print("Searching Lever boards...")
    for board in config.get("lever_boards", []):
        found = lever.fetch(board)
        print(f"  [lever:{board}] {len(found)} jobs")
        jobs.extend(found)

    indeed_cfg = config.get("indeed", {})
    if indeed_cfg.get("enabled"):
        print("Searching Indeed (via headless browser -- may take ~15s per location)...")
        for loc in indeed_cfg.get("locations", []):
            found = indeed.fetch(
                query=indeed_cfg.get("query", "QA Engineer"),
                location=loc,
                domain=indeed_cfg.get("country_domain", "in.indeed.com"),
                max_results=config.get("max_results_per_source", 25),
            )
            print(f"  [indeed:{loc}] {len(found)} jobs")
            jobs.extend(found)

    linkedin_cfg = config.get("linkedin", {})
    if linkedin_cfg.get("enabled"):
        print("Searching LinkedIn (public search, unauthenticated)...")
        for loc in linkedin_cfg.get("locations", []):
            found = linkedin.fetch(
                query=linkedin_cfg.get("query", "QA Engineer"),
                location=loc,
                max_results=config.get("max_results_per_source", 25),
            )
            print(f"  [linkedin:{loc}] {len(found)} jobs")
            jobs.extend(found)

    naukri_cfg = config.get("naukri", {})
    if naukri_cfg.get("enabled"):
        for loc in naukri_cfg.get("locations", []):
            found = naukri.fetch(
                query=naukri_cfg.get("query", ""),
                location=loc,
            )
            jobs.extend(found)

    manual_found = manual.fetch()
    if manual_found:
        print(f"  [manual] {len(manual_found)} jobs loaded from manual_jobs.json")
        jobs.extend(manual_found)

    return jobs


def main():
    status = StatusPublisher()
    profile = load_json("profile.json")
    config = load_json("config.json")

    status.publish("role-scout", "running")
    all_jobs = collect_jobs(config)
    print(f"\nTotal jobs fetched (before scoring/dedup): {len(all_jobs)}")
    status.publish("fit-analyst", "running", discovered=len(all_jobs))

    shortlist = score_and_filter(all_jobs, profile, config.get("min_match_score", 35))
    print(f"Shortlist after scoring/dedup (>= {config.get('min_match_score', 35)} match): {len(shortlist)}")

    material_limit = max(0, int(config.get("max_ai_jobs_per_run", 3)))
    material_jobs = shortlist[:material_limit]
    if len(material_jobs) < len(shortlist):
        print(
            f"Writing application materials for the top {len(material_jobs)} shortlisted jobs "
            f"(max_ai_jobs_per_run={material_limit}); all {len(shortlist)} remain in the report."
        )

    # Fold this run's listings into the demand counts before tailoring, so
    # skills get ordered by what employers actually ask for.
    memory = ats_memory.observe(all_jobs, shortlist, profile, "output")
    print(f"  [ats-memory] {ats_memory.summarize(memory, profile)}")
    demand = ats_memory.demand(memory)

    status.publish(
        "resume-tailor", "running", discovered=len(all_jobs),
        shortlisted=len(shortlist),
    )
    tailor_shortlist(material_jobs, profile, demand)
    resumes_tailored = sum(
        job.draft_resume is not None and bool(job.resume_review and job.resume_review.get("passed"))
        for job in material_jobs
    )

    model = config.get("local_model", "llama3.2:3b")
    model_status = "idle"
    if material_jobs:
        print("\nDrafting application materials with the local model...")
        status.publish(
            "application-writer", "running", discovered=len(all_jobs),
            shortlisted=len(shortlist), resumes_tailored=resumes_tailored,
            model_status="running", model_name=model,
        )
        if wait_until_ready():
            installed = available_models()
            if installed and not any(name.startswith(model.split(":")[0]) for name in installed):
                print(f"  [drafter] model {model} is not installed; available: {', '.join(installed)}")
            draft_shortlist(material_jobs, profile, model, demand)
            model_status = "completed"
        else:
            print("  [drafter] no local model server reachable; shortlist and resumes are still reported.")
            model_status = "failed"
    elif shortlist:
        print("\nMaterial generation is capped at zero jobs for this run; writing the full shortlist report.")
    else:
        print("\nNo jobs cleared the match threshold this run. Try lowering min_match_score in config.json,"
              " or adding more companies to greenhouse_boards/lever_boards.")

    status.publish(
        "application-reviewer", "running", discovered=len(all_jobs),
        shortlisted=len(shortlist), resumes_tailored=resumes_tailored,
    )
    resumes_reviewed = review_resume_drafts(material_jobs, profile)
    resumes_tailored = resumes_reviewed
    status.publish(
        "application-reviewer", "running", discovered=len(all_jobs),
        shortlisted=len(shortlist), resumes_tailored=resumes_tailored,
        phase_complete=True,
    )

    html_path, pdf_path, json_path = write_report(shortlist, profile)
    drafted_count = sum(
        bool(job.draft_cover_note)
        and not job.draft_cover_note.startswith("[Drafting failed")
        for job in material_jobs
    )
    if shortlist and drafted_count == 0 and resumes_tailored == 0:
        print(
            "\nNo application materials were generated. Check the local model "
            "diagnostics above (server reachable? model pulled?)."
        )
    status.publish(
        "application-writer", "running", discovered=len(all_jobs),
        shortlisted=len(shortlist), drafted=drafted_count,
        resumes_tailored=resumes_tailored,
        awaiting_review=drafted_count,
    )
    print(f"\nReport written to:\n  {html_path}\n  {pdf_path}\n  {json_path}")

    # Best-effort and independent of digest success: analyzes whatever
    # outcomes the user has recorded with record_outcome.py since the last
    # run. Never raises -- a missed insight should never fail a job search.
    print("\nChecking for recorded outcomes (Feedback Analyst)...")
    feedback_result, _ = run_feedback_analysis("output", config)
    feedback_status = {
        "insufficient_data": "idle",
        "ok": "completed",
        "error": "failed",
    }.get(feedback_result.get("status"), "idle")

    print("\nSending daily digest...")
    try:
        digest_sent = send_digest(shortlist, profile, config, pdf_path)
    except Exception:
        status.publish(
            "application-coordinator", "failed", discovered=len(all_jobs),
            shortlisted=len(shortlist), drafted=drafted_count,
            resumes_tailored=resumes_tailored, awaiting_review=drafted_count,
            phase_complete=True, feedback_analyst_status=feedback_status,
            model_status=model_status, model_name=model,
        )
        raise

    notifications_enabled = config.get("notify", {}).get("enabled", False)
    if notifications_enabled and not digest_sent:
        print(
            "\nDaily digest was not delivered. Check RESEND_API_KEY and the notifier "
            "diagnostics above; the private report was written to the run output."
        )
        status.publish(
            "application-coordinator", "failed", discovered=len(all_jobs),
            shortlisted=len(shortlist), drafted=drafted_count,
            resumes_tailored=resumes_tailored, awaiting_review=drafted_count,
            phase_complete=True, feedback_analyst_status=feedback_status,
            model_status=model_status, model_name=model,
        )
        return
    if not notifications_enabled:
        print("\nDaily digest notification is disabled in config.json.")

    print("\nDone. Review any drafted notes before applying manually on the original listing.")
    status.publish(
        "application-coordinator", "completed", discovered=len(all_jobs),
        shortlisted=len(shortlist), drafted=drafted_count,
        resumes_tailored=resumes_tailored,
        awaiting_review=drafted_count, phase_complete=True,
        feedback_analyst_status=feedback_status,
        model_status=model_status, model_name=model,
    )


if __name__ == "__main__":
    main()

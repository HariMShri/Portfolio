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
from job_agent.reviewer import review_cover_notes, review_resume_drafts
from job_agent.feedback_analyst import run_feedback_analysis
from job_agent import ats_memory
from job_agent.local_llm import available_models, wait_until_ready
from job_agent.status import StatusPublisher
from job_agent.sources import careers, indeed, linkedin, naukri, manual, remotive
from job_agent import applicant, career_memory


def load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def board_sites(config: dict) -> list[dict]:
    """Every ATS board to read this run: the configured boards plus whatever
    the company careers pages resolve to."""
    sites = [{"platform": "greenhouse", "token": token} for token in config.get("greenhouse_boards", [])]
    sites += [{"platform": "lever", "token": token} for token in config.get("lever_boards", [])]
    sites += [{"platform": "ashby", "token": token} for token in config.get("ashby_boards", [])]
    sites += [{"platform": "smartrecruiters", "token": token} for token in config.get("smartrecruiters_companies", [])]
    sites += [{"platform": "workday", "token": url} for url in config.get("workday_sites", [])]
    return sites


def resolve_career_pages(config: dict, memory: dict) -> list[dict]:
    sites = []
    for url in config.get("career_pages", []):
        resolution = career_memory.cached_resolution(memory, url)
        if resolution is None:
            resolution = careers.resolve(url)
            career_memory.remember_resolution(memory, url, resolution)
            print(f"  [careers] {url} -> {resolution.get('platform') or resolution['status']}")
        if resolution.get("platform"):
            sites.append({"platform": resolution["platform"], "token": resolution["token"]})
        else:
            # Login-only or unreadable careers pages are remembered and skipped, never logged into.
            career_memory.record_visit(memory, career_memory.site_key("careers", url), resolution["status"], 0)
    return sites


def collect_jobs(config: dict, memory: dict) -> list[Job]:
    jobs: list[Job] = []

    print("Reading company job boards and careers pages...")
    sites = board_sites(config) + resolve_career_pages(config, memory)
    seen_keys = set()
    for site in sites:
        key = career_memory.site_key(site["platform"], site["token"])
        if key in seen_keys:
            continue
        seen_keys.add(key)
        reason = career_memory.parked(memory, key)
        if reason:
            print(f"  [{key}] skipped: {reason}")
            continue
        found, status = careers.fetch_site(site)
        career_memory.record_visit(memory, key, status, len(found))
        for job in found:
            job.site = key
        print(f"  [{key}] {len(found)} jobs" + ("" if status in ("ok", "empty") else f" ({status})"))
        jobs.extend(found)

    remotive_cfg = config.get("remotive", {})
    if remotive_cfg.get("enabled"):
        print("Searching remote roles (Remotive)...")
        for category in remotive_cfg.get("categories", []):
            found = remotive.fetch(category=category)
            print(f"  [remotive:{category}] {len(found)} jobs")
            jobs.extend(found)
        for term in remotive_cfg.get("search", []):
            found = remotive.fetch(search=term)
            print(f"  [remotive:'{term}'] {len(found)} jobs")
            jobs.extend(found)

    indeed_cfg = config.get("indeed", {})
    if indeed_cfg.get("enabled"):
        print("Searching Indeed (via headless browser -- may take ~15s per location)...")
        locations = list(indeed_cfg.get("locations", []))
        if indeed_cfg.get("remote"):
            locations.append("Remote")
        for loc in locations:
            found = indeed.fetch(
                query=indeed_cfg.get("query", "QA Engineer"),
                location=loc,
                domain=indeed_cfg.get("country_domain", "in.indeed.com"),
                max_results=config.get("max_results_per_source", 25),
            )
            if loc == "Remote":
                # Indeed India's remote results are remote within India.
                for job in found:
                    if "remote" in job.location.lower() and "india" not in job.location.lower():
                        job.location = f"{job.location} (India)"
                    elif "remote" not in job.location.lower():
                        job.location = f"Remote ({job.location or 'India'})"
            print(f"  [indeed:{loc}] {len(found)} jobs")
            jobs.extend(found)

    linkedin_cfg = config.get("linkedin", {})
    if linkedin_cfg.get("enabled"):
        print("Searching LinkedIn (public search, unauthenticated)...")
        searches = [(loc, False) for loc in linkedin_cfg.get("locations", [])]
        if linkedin_cfg.get("remote"):
            searches.append((linkedin_cfg.get("remote_location", "India"), True))
        for loc, remote_only in searches:
            found = linkedin.fetch(
                query=linkedin_cfg.get("query", "QA Engineer"),
                location=loc,
                max_results=config.get("max_results_per_source", 25),
                remote=remote_only,
            )
            print(f"  [linkedin:{loc}{' remote' if remote_only else ''}] {len(found)} jobs")
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


def pick_material_jobs(shortlist: list[Job], limit: int, prefer_auto_apply: bool) -> list[Job]:
    """Which jobs get a tailored resume and cover note. With prefer_auto_apply,
    jobs the Applicant can submit (Greenhouse/Lever forms) go first, so the
    drafts land where they can actually be used; then new jobs; then score."""
    if not prefer_auto_apply:
        return shortlist[:limit]
    ranked = sorted(shortlist, key=lambda job: (
        applicant.destination_for(job.to_dict()) is None, not job.is_new, -job.match_score,
    ))
    return ranked[:limit]


def main():
    status = StatusPublisher()
    profile = load_json("profile.json")
    config = load_json("config.json")

    status.publish("role-scout", "running")
    sites_memory = career_memory.load("output")
    all_jobs = collect_jobs(config, sites_memory)
    print(f"\nTotal jobs fetched (before scoring/dedup): {len(all_jobs)}")
    status.publish("fit-analyst", "running", discovered=len(all_jobs))

    # Score with what earlier runs learned about skill demand.
    prior_demand = ats_memory.demand(ats_memory.load("output"))
    shortlist = score_and_filter(all_jobs, profile, config.get("min_match_score", 35), prior_demand)
    print(f"Shortlist after scoring/dedup (>= {config.get('min_match_score', 35)} match): {len(shortlist)}")
    remote_count = sum(job.work_mode.startswith("remote") for job in shortlist)
    new_count = career_memory.mark_new(sites_memory, shortlist)
    career_memory.record_shortlisted(sites_memory, shortlist)
    sites_memory["runs"] = sites_memory.get("runs", 0) + 1
    career_memory.save("output", sites_memory)
    print(f"  {new_count} new since earlier runs, {remote_count} remote")
    print(f"  [career-memory] {career_memory.summarize(sites_memory)}")
    site_summary = career_memory.site_report(sites_memory)
    if site_summary["productive"]:
        print("  [career-memory] most productive: "
              + ", ".join(f"{key} ({count})" for key, count in site_summary["productive"][:8]))
    if site_summary["parked"]:
        print("  [career-memory] parked: " + ", ".join(site_summary["parked"]))

    material_limit = max(0, int(config.get("max_ai_jobs_per_run", 3)))
    material_jobs = pick_material_jobs(shortlist, material_limit, config.get("prefer_auto_apply", True))
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
    notes_drafted = sum(job.draft_cover_note is not None for job in material_jobs)
    notes_passed = review_cover_notes(material_jobs, profile)
    if notes_drafted:
        print(f"  [reviewer] {notes_passed}/{notes_drafted} cover notes passed the fact check")
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

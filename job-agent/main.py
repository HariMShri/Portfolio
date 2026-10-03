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
from job_agent import applicant, approvals, career_memory, learning
from job_agent.store import Store, restore_memory_file, save_memory_file


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


def pick_material_jobs(shortlist: list[Job], limit: int, prefer_auto_apply: bool,
                       decided: frozenset = frozenset(), drafted: frozenset = frozenset()) -> list[Job]:
    """Which jobs get a tailored resume and cover note. Jobs you've already
    approved or skipped are left out. With prefer_auto_apply, jobs the
    Applicant can submit go first, so drafts land where they can be used;
    then jobs without a draft yet; then new jobs; then score."""
    candidates = [job for job in shortlist if job.job_id not in decided]
    if not prefer_auto_apply:
        return candidates[:limit]
    ranked = sorted(candidates, key=lambda job: (
        applicant.destination_for(job.to_dict()) is None, job.job_id in drafted, not job.is_new, -job.match_score,
    ))
    return ranked[:limit]


def main():
    status = StatusPublisher()
    profile = load_json("profile.json")
    config = load_json("config.json")

    status.publish("role-scout", "running")
    # Neon (optional): seed memories a cold cache lost, from the shared copy.
    store = Store.open()
    if store is not None:
        restored = [name for name, path in (("ats_memory", "output/ats_memory.json"),
                                            ("career_memory", "output/career_memory.json"))
                    if restore_memory_file(store, name, path)]
        print(f"  [store] connected" + (f"; restored {', '.join(restored)} from the database" if restored else ""))
        try:
            added, skipped = approvals.sync(store)
            if added or skipped:
                print(f"  [approvals] {added} new approval(s), {skipped} skip(s) from the digest email")
        except Exception as error:
            print(f"  [approvals] couldn't sync from the worker ({type(error).__name__})")
        learned = learning.load(store)
        print(f"  [learning] {learning.summarize(learned)}")
        # Don't hold the connection through the long middle of the run: Neon
        # closes idle connections, so reconnect for each later step instead.
        store.close()
    use_db = store is not None
    if not use_db:
        learned = learning.load(None)
    sites_memory = career_memory.load("output")
    all_jobs = collect_jobs(config, sites_memory)
    print(f"\nTotal jobs fetched (before scoring/dedup): {len(all_jobs)}")
    status.publish("fit-analyst", "running", discovered=len(all_jobs))

    # Score with what earlier runs learned about skill demand.
    prior_demand = ats_memory.demand(ats_memory.load("output"))
    shortlist = score_and_filter(all_jobs, profile, config.get("min_match_score", 35), prior_demand,
                                 learned["calibration"])
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
    material_jobs = pick_material_jobs(shortlist, material_limit, config.get("prefer_auto_apply", True),
                                       frozenset(learned["decided"]), frozenset(learned["drafts"]))
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
    tailor_shortlist(material_jobs, profile, demand, learned["boosts"])
    resumes_tailored = sum(
        job.draft_resume is not None and bool(job.resume_review and job.resume_review.get("passed"))
        for job in material_jobs
    )

    model = config.get("local_model", "llama3.2:3b")
    model_status = "idle"
    # Application Writer: reuse fact-checked notes from earlier runs instead of
    # asking the model again; only jobs without one need drafting.
    reused = learning.reusable_drafts(learned["drafts"], material_jobs)
    for job in material_jobs:
        if job.job_id in reused:
            job.draft_cover_note = reused[job.job_id]["cover_note"]
            job.draft_qa = reused[job.job_id]["qa"]
    to_draft = [job for job in material_jobs if job.job_id not in reused]
    if reused:
        print(f"  [drafter] reusing {len(reused)} fact-checked cover note(s) from earlier runs; "
              f"{len(to_draft)} to draft")
    if to_draft:
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
            draft_shortlist(to_draft, profile, model, demand)
            model_status = "completed"
        else:
            print("  [drafter] no local model server reachable; shortlist and resumes are still reported.")
            model_status = "failed"
    elif material_jobs:
        print("  [drafter] every selected job already has a fact-checked note; no model calls needed")
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
    store = Store.open() if use_db else None
    if store is not None:
        try:
            run_id = store.save_run(shortlist, len(all_jobs))
            save_memory_file(store, "ats_memory", "output/ats_memory.json")
            save_memory_file(store, "career_memory", "output/career_memory.json")
            print(f"  [store] saved run {run_id}: {len(shortlist)} shortlisted jobs and both memories")
        except Exception as error:
            print(f"  [store] couldn't save this run ({type(error).__name__}); the report and email are unaffected")

    # Best-effort and independent of digest success: analyzes whatever
    # outcomes the user has recorded with record_outcome.py since the last
    # run. Never raises -- a missed insight should never fail a job search.
    print("\nChecking for recorded outcomes (Feedback Analyst)...")
    db_outcomes = db_index = None
    if store is not None:
        try:
            db_outcomes, db_index = store.outcomes(), store.job_index()
            print(f"  [store] {len(db_outcomes)} recorded outcome(s) in the database")
        except Exception as error:
            print(f"  [store] couldn't read outcomes ({type(error).__name__})")
        store.close()
    feedback_result, _ = run_feedback_analysis("output", config, db_outcomes, db_index)
    feedback_status = {
        "insufficient_data": "idle",
        "ok": "completed",
        "error": "failed",
    }.get(feedback_result.get("status"), "idle")

    print("\nSending daily digest...")
    try:
        base, key = approvals.credentials()
        links = {
            job.job_id: approvals.approval_links(job.to_dict(), base, key)
            for job in material_jobs
            if applicant.destination_for(job.to_dict()) and job.resume_review and job.resume_review.get("passed")
        }
        links = {job_id: value for job_id, value in links.items() if value}
        if links:
            print(f"  [approvals] asking for approval on {len(links)} job(s) in the digest")
        digest_sent = send_digest(shortlist, profile, config, pdf_path, links)
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

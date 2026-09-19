"""Job search agent: searches configured sources, scores matches against your
profile, drafts application materials for the shortlist via the Gemini API,
and writes a local HTML report for you to review. It does not submit anything
anywhere -- you review each draft and apply manually on the original listing.

Usage:
    python main.py
"""
import json

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # python-dotenv not installed -- GEMINI_API_KEY must be set some other way

from job_agent.models import Job
from job_agent.matcher import score_and_filter
from job_agent.drafter import draft_shortlist
from job_agent.report import write_report
from job_agent.notifier import send_digest
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
    profile = load_json("profile.json")
    config = load_json("config.json")

    all_jobs = collect_jobs(config)
    print(f"\nTotal jobs fetched (before scoring/dedup): {len(all_jobs)}")

    shortlist = score_and_filter(all_jobs, profile, config.get("min_match_score", 35))
    print(f"Shortlist after scoring/dedup (>= {config.get('min_match_score', 35)} match): {len(shortlist)}")

    if shortlist:
        print("\nDrafting application materials for the shortlist...")
        draft_shortlist(shortlist, profile, config.get("gemini_model", "gemini-3.6-flash"))
    else:
        print("\nNo jobs cleared the match threshold this run. Try lowering min_match_score in config.json,"
              " or adding more companies to greenhouse_boards/lever_boards.")

    html_path, pdf_path, json_path = write_report(shortlist, profile)
    print(f"\nReport written to:\n  {html_path}\n  {pdf_path}\n  {json_path}")

    print("\nSending daily digest...")
    send_digest(shortlist, profile, config, pdf_path)

    print("\nDone. Review any drafted notes before applying manually on the original listing.")


if __name__ == "__main__":
    main()

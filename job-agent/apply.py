"""Apply to shortlisted jobs on your behalf -- each one only after you approve it.

Usage:
    python apply.py                    # list jobs in the latest report and how each can be applied to
    python apply.py --job-id a1b2c3    # prepare, approve and apply to one job
    python apply.py --all              # walk every job that has an application form, one approval each

For each job you approve, the Applicant agent:
  1. builds a tailored resume PDF (and a cover letter PDF if a draft exists)
     from verified profile.json facts only;
  2. records your approval, tied to the job, the exact form URL and the
     SHA-256 of each file -- it expires after 24 hours;
  3. confirms the posting is still open, opens the employer's Greenhouse or
     Lever form in a visible browser, and fills your details and files;
  4. submits only if you chose "submit for me" and nothing required is left
     -- custom questions and CAPTCHAs are always left to you, in that window.

LinkedIn, Indeed and Naukri prohibit automated applications, so for those the
agent prepares the files and opens the listing for you to apply yourself.
Nothing leaves this machine except the application you approve.
"""
import argparse
import glob
import json
import os
import sys
import webbrowser
from dataclasses import asdict

try:
    from dotenv import load_dotenv
    load_dotenv()  # DATABASE_URL from the gitignored .env
except ImportError:
    pass

from job_agent import applicant, career_memory
from job_agent.store import Store
from job_agent.outcomes import record_outcome


def latest_report(output_dir: str):
    reports = sorted(glob.glob(os.path.join(output_dir, "report_*.json")))
    if not reports:
        return None, []
    with open(reports[-1], encoding="utf-8") as f:
        jobs = json.load(f)
    for job in jobs:  # reports from before job IDs existed
        if not job.get("job_id"):
            job["job_id"] = applicant.job_from_dict(job).job_id
    return reports[-1], jobs


def load_shortlist(output_dir: str, local_only: bool):
    """Today's shortlist from the shared database (written by the daily run),
    falling back to the newest local report_*.json."""
    if not local_only:
        store = Store.open()
        if store is not None:
            try:
                run_id, created_at, jobs = store.latest_shortlist()
            finally:
                store.close()
            if jobs:
                return f"database run {run_id} ({created_at:%Y-%m-%d %H:%M} UTC)", jobs
    return latest_report(output_dir)


def ask(prompt: str, choices: str, default: str) -> str:
    while True:
        try:
            answer = input(prompt).strip().lower() or default
        except EOFError:
            return default
        if answer in choices:
            return answer


def describe(package: applicant.Package, profile: dict) -> None:
    first, last = applicant.split_name(profile)
    print(f"\n  {package.title} -- {package.company}")
    print(f"  Listing:     {package.listing_url}")
    if package.destination:
        print(f"  Form:        {package.destination['form_url']}")
    for name, path in package.files.items():
        print(f"  {name:<12} {path}  (sha256 {applicant.sha256_file(path)[:12]})")
    print(f"  Will enter:  {first} {last} | {profile.get('email')} | {profile.get('phone')} | LinkedIn/GitHub links")
    if package.cover_note:
        preview = package.cover_note[:420] + ("..." if len(package.cover_note) > 420 else "")
        print("  Cover note (read it -- it goes to the employer):\n    " + preview.replace("\n", "\n    "))
    else:
        print("  Cover note:  none (no usable draft for this job)")


def confirm_user_submitted(output_dir: str, package: applicant.Package, platform: str) -> None:
    if ask("  Did you submit the application? [y/N] ", "yn", "n") == "y":
        applicant.log_attempt(output_dir, applicant.Attempt(package.job_id, platform, "submitted_by_user"))
        record_outcome(output_dir, package.job_id, package.company, package.title, "applied",
                       note=f"Submitted by you via {platform}, filled by the Applicant agent")
        print("  Recorded as applied.")


def run_browser(package, profile, scope, output_dir, headless):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  Playwright isn't installed: pip install playwright && python -m playwright install chromium")
        return
    platform = package.destination["platform"]
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        try:
            page.goto(package.destination["form_url"], wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(2500)
            attempt = applicant.apply_in_page(page, package, profile, scope, answers=applicant.load_answers())
        except Exception as error:
            attempt = applicant.Attempt(package.job_id, platform, "blocked", f"browser error: {type(error).__name__}")
        applicant.log_attempt(output_dir, attempt)
        # Teach the career memory what applying here actually takes.
        memory = career_memory.load(output_dir)
        career_memory.learn_apply_route(memory, platform, attempt.status)
        career_memory.save(output_dir, memory)

        if attempt.status == "submitted":
            record_outcome(output_dir, package.job_id, package.company, package.title, "applied",
                           note=f"Submitted by the Applicant agent via {platform}")
            print(f"  Submitted. {attempt.detail}. Recorded as applied.")
        elif attempt.status == "blocked":
            print(f"  Stopped: {attempt.detail}")
        else:
            print(f"  {attempt.detail}.")
            for blocker in attempt.blockers:
                print(f"    - {blocker}")
            if headless:
                print("  (Headless run: open the form yourself to finish.)")
            else:
                input("  Finish the form in the browser window if you want to apply, then press Enter here... ")
                confirm_user_submitted(output_dir, package, platform)
        browser.close()


def handle(job: dict, profile: dict, args) -> None:
    try:
        package = applicant.build_package(job, profile, args.output_dir,
                                          include_cover_letter=not args.no_cover_letter, rebuild=args.rebuild)
    except applicant.PackageError as error:
        print(f"\n  {job.get('title')} -- {job.get('company')}: skipped ({error})")
        return
    describe(package, profile)

    if not package.destination:
        print(f"  {applicant.manual_reason(job)} -- apply yourself with the files above.")
        if ask("  Open the listing in your browser now? [y/N] ", "yn", "n") == "y":
            webbrowser.open(package.listing_url)
            confirm_user_submitted(args.output_dir, package, job.get("source", "listing"))
        return

    platform = package.destination["platform"]
    if not applicant.listing_open(package.destination):
        applicant.log_attempt(args.output_dir, applicant.Attempt(package.job_id, platform, "blocked", "posting closed"))
        print("  The posting is no longer open -- skipped.")
        return

    approval = applicant.latest_approval(args.output_dir, package.job_id)
    if applicant.approval_problems(approval, package):
        choice = ask("  Apply to this job? [s] submit for me  [f] fill the form, I'll press submit  [N] skip: ",
                     "sfn", "n")
        if choice == "n":
            return
        approval = asdict(applicant.approve(
            args.output_dir, package, "submit" if choice == "s" else "fill", f"{profile.get('name', 'user')} (apply.py)",
        ))

    # Re-verify immediately before acting: same files, same destination, unexpired.
    problems = applicant.approval_problems(approval, package)
    if problems:
        applicant.log_attempt(args.output_dir, applicant.Attempt(package.job_id, platform, "blocked", "; ".join(problems)))
        print("  Not applying: " + "; ".join(problems))
        return
    run_browser(package, profile, approval["scope"], args.output_dir, args.headless)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--job-id", help="job_id from the report (shown by `python apply.py`)")
    parser.add_argument("--all", action="store_true", help="go through every job with an application form")
    parser.add_argument("--output-dir", default="output")
    parser.add_argument("--local", action="store_true", help="use the newest local report instead of the database")
    parser.add_argument("--profile", default="profile.json")
    parser.add_argument("--no-cover-letter", action="store_true", help="never attach the drafted cover note")
    parser.add_argument("--rebuild", action="store_true", help="regenerate files (needs a fresh approval)")
    parser.add_argument("--headless", action="store_true", help="no visible browser (you can't finish forms)")
    args = parser.parse_args()

    report, jobs = load_shortlist(args.output_dir, args.local)
    if not jobs:
        print("No shortlist found in the database or output/. Set DATABASE_URL in .env, or run `python main.py`.")
        return 1
    with open(args.profile, encoding="utf-8") as f:
        profile = json.load(f)
    print(f"Using {report} ({len(jobs)} jobs)")

    if args.job_id:
        chosen = [job for job in jobs if job.get("job_id") == args.job_id]
        if not chosen:
            print(f"No job {args.job_id!r} in that report.")
            return 1
    elif args.all:
        chosen = [job for job in jobs if applicant.destination_for(job)]
        if not chosen:
            print("None of these jobs has a Greenhouse or Lever form; use --job-id to prepare one for manual applying.")
            return 0
    else:
        for job in jobs:
            destination = applicant.destination_for(job)
            how = f"auto ({destination['platform']})" if destination else "you apply (" + job.get("source", "?") + ")"
            print(f"  {job.get('job_id')}  {job.get('match_score', 0):>3.0f}  {how:<22} {job.get('title')} -- {job.get('company')}")
        print("\nRun with --job-id <id> for one job, or --all for every job with an application form.")
        return 0

    for job in chosen:
        handle(job, profile, args)
    return 0


if __name__ == "__main__":
    sys.exit(main())

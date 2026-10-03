"""Record what actually happened on a job the agent shortlisted.

The agent never submits anything, so it has no way to know on its own
whether you applied, heard back, got an interview, or an offer. Feedback
Analyst can only learn from outcomes you record yourself, here.

Usage:
    python record_outcome.py --job-id a1b2c3d4e5f6 --decision interview
    python record_outcome.py --company "Example Co" --title "QA Engineer" \\
        --decision applied --note "Applied via referral"

Find --job-id in the most recent output/report_<timestamp>.json (each job
entry has a stable "job_id" field) -- or just pass --company/--title
directly and this looks the job up for you.
"""
import argparse
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()  # DATABASE_URL, so the outcome also reaches the shared database
except ImportError:
    pass

from job_agent.outcomes import DECISIONS, find_job_by_id, record_outcome


def _job_from_database(job_id: str):
    from job_agent.store import Store
    store = Store.open(quiet=True)
    if store is None:
        return None
    try:
        return store.job_index().get(job_id)
    finally:
        store.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--job-id", help="job_id from a report_*.json entry")
    parser.add_argument("--company")
    parser.add_argument("--title")
    parser.add_argument("--decision", required=True, choices=DECISIONS)
    parser.add_argument("--note", default="")
    parser.add_argument("--output-dir", default="output")
    args = parser.parse_args()

    company, title, job_id = args.company, args.title, args.job_id
    if job_id and not (company and title):
        job = find_job_by_id(args.output_dir, job_id) or _job_from_database(job_id)
        if job:
            company = company or job.get("company", "")
            title = title or job.get("title", "")
        else:
            print(
                f"No job with id {job_id!r} found in {args.output_dir}/report_*.json; "
                "pass --company and --title directly as well.",
                file=sys.stderr,
            )

    if not job_id:
        print("--job-id is required (find it in the latest report_*.json).", file=sys.stderr)
        return 1
    if not (company and title):
        print("Could not resolve company/title for this job_id; pass --company and --title explicitly.", file=sys.stderr)
        return 1

    outcome = record_outcome(args.output_dir, job_id, company, title, args.decision, args.note)
    print(f"Recorded: {outcome.decision} -- {outcome.title} @ {outcome.company} ({outcome.job_id})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

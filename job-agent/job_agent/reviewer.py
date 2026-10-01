"""Deterministically validate tailored resume selections against profile evidence."""
from .models import Job
from .resume_tailor import validate_resume_plan


def review_resume_drafts(jobs: list[Job], profile: dict) -> int:
    passed = 0
    for job in jobs:
        plan, issues = validate_resume_plan(job.draft_resume, profile)
        job.draft_resume = plan
        job.resume_review = {"passed": not issues, "issues": issues}
        passed += int(not issues)
    return passed
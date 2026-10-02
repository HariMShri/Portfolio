"""Select and order truthful resume evidence for a specific job.

Selection is local and deterministic (see `local_tailor`): the output is
indexes into profile.json, so there was never anything for a model to add
that the validator would not reject anyway. `validate_resume_plan` stays as
the guarantee at the boundary -- it now checks a selector that structurally
cannot wander, rather than a model that could.
"""
from typing import Optional

from .local_tailor import select_evidence
from .models import Job


def validate_resume_plan(plan: object, profile: dict) -> tuple[Optional[dict], list[str]]:
    issues = []
    if not isinstance(plan, dict):
        return None, ["Resume selection is missing or is not an object."]

    experience = plan.get("experience")
    if not isinstance(experience, list) or not experience:
        issues.append("Select at least one source experience entry.")
        experience = []
    if len(experience) > len(profile.get("experience", [])):
        issues.append("Resume selection contains too many experience entries.")

    safe_experience = []
    seen_experience = set()
    source_experience = profile.get("experience", [])
    for item in experience:
        if not isinstance(item, dict):
            issues.append("An experience selection is malformed.")
            continue
        experience_index = item.get("experience_index")
        if type(experience_index) is not int or not 0 <= experience_index < len(source_experience):
            issues.append("An experience selection points outside the source profile.")
            continue
        if experience_index in seen_experience:
            issues.append("An experience entry is selected more than once.")
            continue
        seen_experience.add(experience_index)

        source_highlights = source_experience[experience_index].get("highlights", [])
        highlight_indices = item.get("highlight_indices")
        if not isinstance(highlight_indices, list) or not highlight_indices:
            issues.append("Each selected experience must include source highlights.")
            continue
        if any(type(index) is not int or not 0 <= index < len(source_highlights) for index in highlight_indices):
            issues.append("An experience highlight points outside the source profile.")
            continue
        if len(set(highlight_indices)) != len(highlight_indices):
            issues.append("An experience highlight is selected more than once.")
            continue
        safe_experience.append({
            "experience_index": experience_index,
            "highlight_indices": highlight_indices,
        })

    skills = plan.get("skills")
    source_skills = profile.get("skills", [])
    if not isinstance(skills, list) or not skills:
        issues.append("Select at least one source skill.")
        skills = []
    if len(skills) > min(20, len(source_skills)):
        issues.append("Resume selection contains too many skills.")
    if any(not isinstance(skill, str) or skill not in source_skills for skill in skills):
        issues.append("A selected skill is not present in the source profile.")
    if len(set(skills)) != len(skills):
        issues.append("A skill is selected more than once.")

    if issues:
        return None, issues
    return {"experience": safe_experience, "skills": skills}, []


def tailor_resume_for_job(job: Job, profile: dict, demand: Optional[dict] = None) -> Job:
    plan = select_evidence(job, profile, demand)
    safe_plan, issues = validate_resume_plan(plan, profile)
    job.draft_resume = safe_plan
    job.resume_review = {"passed": not issues, "issues": issues}
    return job


def tailor_shortlist(jobs: list[Job], profile: dict, demand: Optional[dict] = None) -> list[Job]:
    for index, job in enumerate(jobs, start=1):
        print(f"  [resume-tailor] selecting evidence {index}/{len(jobs)}")
        tailor_resume_for_job(job, profile, demand)
    return jobs

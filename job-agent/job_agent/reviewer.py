"""Deterministically validate tailored resume selections against profile evidence."""
import json
import re

from .ats_memory import TECH_VOCAB
from .local_tailor import normalize, term_in_text
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

# ---------- cover notes ----------

# A sentence that names a skill alongside one of these is acknowledging a gap
# ("eager to learn Kubernetes"), not claiming it.
GAP_WORDS = re.compile(
    r"\b(learn\w*|eager|keen|new to|not yet|haven'?t|have not|growing|exposure|ramp\w* up|pick\w* up|familiari[sz]\w*)\b",
    re.I,
)
NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")


def review_cover_note(job: Job, profile: dict) -> dict:
    """Every number and every tool the note claims must exist in profile.json.

    The note is written by a small local model and, through the Applicant,
    can reach an employer -- so anything it states about the candidate that
    the profile can't back is flagged and the note is held back."""
    note = (job.draft_cover_note or "").strip()
    if not note or note.startswith("[Drafting failed"):
        return {"passed": False, "issues": ["no usable cover note was drafted"]}

    profile_text = json.dumps(profile, ensure_ascii=False)
    evidence_norm = normalize(profile_text)
    job_norm = normalize(f"{job.title} {job.company} {job.description}")
    known_numbers = {n.replace(",", "") for n in NUMBER.findall(profile_text)}
    known_numbers |= {n.replace(",", "") for n in NUMBER.findall(f"{job.title} {job.description}")}

    issues = []
    for number in NUMBER.findall(note):
        if number.replace(",", "") not in known_numbers:
            issues.append(f"states the number {number}, which isn't in your profile")

    for sentence in re.split(r"(?<=[.!?])\s+", note):
        sentence_norm = normalize(sentence)
        if GAP_WORDS.search(sentence):
            continue
        for term in TECH_VOCAB:
            if term_in_text(term, sentence_norm) and not term_in_text(term, evidence_norm):
                issues.append(f"claims '{term}', which isn't in your profile")

    # Naming the hiring company is expected; naming any other employer must
    # match one from your experience.
    employers = {normalize(e.get("company", "")).strip() for e in profile.get("experience", [])}
    for name in re.findall(r"\b(?:at|with|for|from)\s+([A-Z][\w&.-]+(?:\s+[A-Z][\w&.-]+){0,3})", note):
        name = name.rstrip(".,;:!?")
        name_norm = normalize(name).strip(" .")
        if not name_norm or name_norm in TECH_VOCAB or term_in_text(name_norm, job_norm) or term_in_text(name_norm, evidence_norm):
            continue
        if not any(name_norm in employer or employer in name_norm for employer in employers if employer):
            issues.append(f"mentions '{name}', which isn't an employer in your profile")

    unique = list(dict.fromkeys(issues))
    return {"passed": not unique, "issues": unique}


def review_cover_notes(jobs: list[Job], profile: dict) -> int:
    passed = 0
    for job in jobs:
        if job.draft_cover_note is None:
            continue
        job.cover_review = review_cover_note(job, profile)
        passed += int(job.cover_review["passed"])
    return passed

"""Drafts a tailored cover note + answers to common application questions for
each shortlisted job, using only facts present in profile.json. This is a
draft for YOU to review and edit before submitting anywhere -- it is not
wired up to actually submit applications.

Runs against a local model (Ollama) rather than a hosted API: no key, no
quota, no per-call cost, and the profile text never leaves the machine or
runner. Generation on a CPU runner is slow but free, so the per-run cap is
about wall-clock time now, not spend.

This is the only step that still needs a model. Evidence selection moved to
`local_tailor`, which is deterministic.
"""
import json

from .local_llm import generate_json
from .local_tailor import normalize, term_in_text
from .models import Job

PROFILE_EVIDENCE_FIELDS = (
    "years_experience",
    "current_title",
    "current_company",
    "summary",
    "skills",
    "experience",
    "education",
    "certifications",
)

SYSTEM_PROMPT = """You are helping a real job candidate draft application materials. \
You MUST only use facts given to you in the candidate profile -- never invent \
employers, metrics, skills, or experience the candidate doesn't have. If the job \
asks for something not covered by the profile, acknowledge the gap honestly rather \
than fabricating a match. Keep the tone professional, direct, and specific to the \
actual job description provided -- avoid generic filler. Reply with JSON only."""

USER_PROMPT_TEMPLATE = """CANDIDATE PROFILE:
{profile_json}

JOB POSTING:
Title: {title}
Company: {company}
Location: {location}
Description:
{description}
{keyword_hint}{style_hint}
Write:
1. A short cover note (120-180 words) tailored to this specific job, grounded only \
in the candidate's real profile above.
2. Three likely application-form questions for a role like this (e.g. "Why this \
role?", "Relevant experience?") each with a concise 2-4 sentence answer drawn from \
the profile.

Respond as JSON with this exact shape:
{{"cover_note": "...", "qa": [{{"question": "...", "answer": "..."}}, ...]}}
Respond with ONLY the JSON, no other text."""

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "cover_note": {"type": "string"},
        "qa": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"question": {"type": "string"}, "answer": {"type": "string"}},
                "required": ["question", "answer"],
            },
        },
    },
    "required": ["cover_note", "qa"],
}


def keyword_hint(job: Job, profile: dict, demand=None) -> str:
    """Surface the terms this listing shares with the profile, ranked by how
    often the wider market asks for them, so the note leads with the evidence
    an ATS screen is most likely to look for."""
    if not demand:
        return ""
    job_norm = normalize(f"{job.title} {job.description}")
    owned = [
        skill for skill in profile.get("skills", [])
        if term_in_text(skill, job_norm)
    ]
    if not owned:
        return ""
    owned.sort(key=lambda skill: -demand.get(normalize(skill).strip(), 0))
    return (
        "\nThese profile skills appear in this listing and are commonly required "
        f"for this kind of role -- prefer them where they fit honestly: {', '.join(owned[:8])}.\n"
    )


def style_hint(profile: dict) -> str:
    """profile.json may hold a short "writing_sample" in the candidate's own
    words. It steers tone only; facts still come from the profile."""
    sample = (profile.get("writing_sample") or "").strip()
    if not sample:
        return ""
    return (
        "\nSTYLE SAMPLE written by the candidate -- match its tone, sentence length and plainness, "
        f"but take no facts from it:\n<<<\n{sample[:1200]}\n>>>\n"
    )


def draft_for_job(job: Job, profile: dict, model: str, demand=None) -> Job:
    profile_evidence = {key: profile[key] for key in PROFILE_EVIDENCE_FIELDS if key in profile}
    prompt = USER_PROMPT_TEMPLATE.format(
        profile_json=json.dumps(profile_evidence, indent=2),
        title=job.title,
        company=job.company,
        location=job.location,
        description=job.description[:4000] or "(no description available -- draft from title/company alone and flag that in the cover note)",
        keyword_hint=keyword_hint(job, profile, demand),
        style_hint=style_hint(profile),
    )
    parsed, error = generate_json(prompt, SYSTEM_PROMPT, model, "drafter", RESPONSE_SCHEMA)
    if error is not None:
        job.draft_cover_note = f"[Drafting failed: {error}]"
        job.draft_qa = []
        return job
    job.draft_cover_note = parsed.get("cover_note")
    job.draft_qa = parsed.get("qa", [])
    return job


def draft_shortlist(jobs: list[Job], profile: dict, model: str, demand=None) -> list[Job]:
    for i, job in enumerate(jobs):
        print(f"  [drafter] drafting {i + 1}/{len(jobs)}: {job.title} @ {job.company}")
        draft_for_job(job, profile, model, demand)
    return jobs

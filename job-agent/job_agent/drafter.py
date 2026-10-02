"""Drafts a tailored cover note + answers to common application questions for
each shortlisted job, using only facts present in profile.json. This is a
draft for YOU to review and edit before submitting anywhere -- it is not
wired up to actually submit applications.

Uses the Gemini API (generativelanguage.googleapis.com) via plain REST calls
-- no SDK dependency needed beyond `requests`, which the rest of the agent
already uses. Free tier is enough for the handful of drafts this needs per
run. Get a key at aistudio.google.com/apikey (GEMINI_API_KEY).
"""
import json
import os

from .gemini_client import gemini_json_request
from .models import GeminiRunState, Job

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
actual job description provided -- avoid generic filler."""

USER_PROMPT_TEMPLATE = """CANDIDATE PROFILE:
{profile_json}

JOB POSTING:
Title: {title}
Company: {company}
Location: {location}
Description:
{description}

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


def draft_for_job(
    job: Job,
    profile: dict,
    api_key: str,
    model: str,
    run_state: GeminiRunState | None = None,
) -> Job:
    profile_evidence = {key: profile[key] for key in PROFILE_EVIDENCE_FIELDS if key in profile}
    prompt = USER_PROMPT_TEMPLATE.format(
        profile_json=json.dumps(profile_evidence, indent=2),
        title=job.title,
        company=job.company,
        location=job.location,
        description=job.description[:4000] or "(no description available -- draft from title/company alone and flag that in the cover note)",
    )
    parsed, error = gemini_json_request(
        prompt, SYSTEM_PROMPT, api_key, model, run_state, "drafter", RESPONSE_SCHEMA
    )
    if error is not None:
        job.draft_cover_note = f"[Drafting failed: {error}]"
        job.draft_qa = []
        return job
    job.draft_cover_note = parsed.get("cover_note")
    job.draft_qa = parsed.get("qa", [])
    return job


def draft_shortlist(
    jobs: list[Job],
    profile: dict,
    model: str,
    run_state: GeminiRunState | None = None,
) -> list[Job]:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("  [drafter] GEMINI_API_KEY not set -- skipping drafting, jobs will be listed without draft materials.")
        return jobs

    for i, job in enumerate(jobs):
        if run_state is not None and run_state.rate_limited:
            print("  [drafter] stopping remaining Gemini requests after rate limit")
            break
        print(f"  [drafter] drafting {i + 1}/{len(jobs)}: {job.title} @ {job.company}")
        draft_for_job(job, profile, api_key, model, run_state)
    return jobs

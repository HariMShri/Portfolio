"""Drafts a tailored cover note + answers to common application questions for
each shortlisted job, using only facts present in profile.json. This is a
draft for YOU to review and edit before submitting anywhere -- it is not
wired up to actually submit applications.
"""
import json
import os
from .models import Job

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


def draft_for_job(job: Job, profile: dict, client, model: str) -> Job:
    prompt = USER_PROMPT_TEMPLATE.format(
        profile_json=json.dumps(profile, indent=2),
        title=job.title,
        company=job.company,
        location=job.location,
        description=job.description[:4000] or "(no description available -- draft from title/company alone and flag that in the cover note)",
    )
    try:
        resp = client.messages.create(
            model=model,
            max_tokens=1200,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:]
        parsed = json.loads(text)
        job.draft_cover_note = parsed.get("cover_note")
        job.draft_qa = parsed.get("qa", [])
    except Exception as e:
        job.draft_cover_note = f"[Drafting failed for this job: {e}]"
        job.draft_qa = []
    return job


def draft_shortlist(jobs: list[Job], profile: dict, model: str) -> list[Job]:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("  [drafter] ANTHROPIC_API_KEY not set -- skipping drafting, jobs will be listed without draft materials.")
        return jobs

    try:
        import anthropic
    except ImportError:
        print("  [drafter] anthropic package not installed -- run: pip install anthropic")
        return jobs

    client = anthropic.Anthropic(api_key=api_key)
    for i, job in enumerate(jobs):
        print(f"  [drafter] drafting {i + 1}/{len(jobs)}: {job.title} @ {job.company}")
        draft_for_job(job, profile, client, model)
    return jobs

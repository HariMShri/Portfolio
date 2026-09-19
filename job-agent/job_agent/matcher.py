"""Scores scraped jobs against the candidate profile. Pure keyword/heuristic
matching -- no AI call here, so this step is free and runs on every job
before the (paid) drafting step only touches the shortlist that clears the bar.
"""
import re
from .models import Job

NEGATIVE_TITLE_WORDS = [
    "senior manager", "director", "vp ", "head of", "principal architect",
    "intern", "internship",
]


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9\s]", " ", text.lower())


def score_job(job: Job, profile: dict) -> Job:
    title_norm = _normalize(job.title)
    desc_norm = _normalize(job.description)
    combined = f"{title_norm} {desc_norm}"

    score = 0.0
    reasons = []

    # Title relevance is a HARD GATE, not just a bonus. Skill-keyword overlap alone
    # (SQL, Docker, Git, API...) is common across totally unrelated engineering roles,
    # so a title with zero QA/testing signal is rejected outright regardless of how
    # many shared tools its description happens to mention.
    title_is_exact_target = False
    for target in profile["target_titles"]:
        if _normalize(target) in title_norm:
            title_is_exact_target = True
            score += 30
            reasons.append(f"Title matches target role \"{target}\"")
            break

    title_has_qa_keyword = any(
        w in title_norm for w in ["test", "qa", "quality assurance", "sdet", "quality engineer"]
    )
    if not title_is_exact_target and title_has_qa_keyword:
        score += 12
        reasons.append("Title contains a QA/testing keyword")

    if not title_is_exact_target and not title_has_qa_keyword:
        job.match_score = 0.0
        job.match_reasons = ["Title has no QA/testing signal -- excluded regardless of skill-keyword overlap"]
        return job

    # Skill overlap in the description
    matched_skills = [s for s in profile["skills"] if _normalize(s) in desc_norm]
    if matched_skills:
        skill_points = min(35, len(matched_skills) * 4)
        score += skill_points
        reasons.append(f"{len(matched_skills)} profile skills found in listing: {', '.join(matched_skills[:8])}")

    # Location relevance
    loc_norm = _normalize(job.location)
    for target_loc in profile["target_locations"]:
        if _normalize(target_loc) in loc_norm:
            score += 15
            reasons.append(f"Location matches \"{target_loc}\"")
            break

    # Seniority sanity check -- penalize obviously mismatched senior/leadership titles
    if any(neg in title_norm for neg in NEGATIVE_TITLE_WORDS):
        score -= 25
        reasons.append("Title suggests a seniority/function mismatch")

    # Experience-level heuristic: flag postings asking for much more experience than the candidate has
    years_needed = _extract_years_required(combined)
    if years_needed is not None and years_needed > profile["years_experience"] + 3:
        score -= 15
        reasons.append(f"Listing asks for ~{years_needed}+ years, above your {profile['years_experience']}")

    job.match_score = round(max(0.0, min(100.0, score)), 1)
    job.match_reasons = reasons
    return job


def _extract_years_required(text: str) -> int | None:
    matches = re.findall(r"(\d{1,2})\s*\+?\s*years", text)
    if not matches:
        return None
    return max(int(m) for m in matches)


def score_and_filter(jobs: list[Job], profile: dict, min_score: float) -> list[Job]:
    scored = [score_job(j, profile) for j in jobs]
    seen = set()
    deduped = []
    for j in sorted(scored, key=lambda x: x.match_score, reverse=True):
        key = j.dedupe_key()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(j)
    return [j for j in deduped if j.match_score >= min_score]

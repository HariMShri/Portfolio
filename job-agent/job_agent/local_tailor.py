"""Deterministic resume evidence selection -- no model involved.

Choosing which existing bullets and skills to surface for a job is a ranking
problem over a fixed set, not a generation problem. The output is indexes
into profile.json, and `validate_resume_plan` rejects anything that is not
already in the profile, so a model could only ever propose what this module
can select directly.

Doing it locally is instant, free, deterministic, and structurally unable to
invent a claim -- the failure mode the validator existed to catch.
"""
import re

STOPWORDS = frozenset("""
and the for with you our are from that this will have has not but all any can its their
your they them who what when where which while into over under about across been were was its
role job work team teams year years experience experiencing required requirements requirement
strong excellent good ability able plus bonus nice must should would could may might
we us a an of to in on at as is be by or if it so such other others more most less
""".split())

# Multiword skills ("API testing") only ever match as phrases; single tokens
# match on word boundaries so "Java" never matches "JavaScript".
WORD_RE = re.compile(r"[a-z0-9+#.]+")


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9+#.\s]", " ", (text or "").lower())


def tokenize(text: str) -> set:
    return {
        token for token in WORD_RE.findall(normalize(text))
        if len(token) > 2 and token not in STOPWORDS
    }


def term_in_text(term: str, text_norm: str) -> bool:
    """Whole-term match: phrases as substrings, single words on boundaries."""
    term_norm = normalize(term).strip()
    if not term_norm:
        return False
    if " " in term_norm:
        return term_norm in text_norm
    return re.search(rf"(?<![a-z0-9]){re.escape(term_norm)}(?![a-z0-9])", text_norm) is not None


def select_skills(job_text_norm: str, profile: dict, demand=None, limit: int = 20) -> list:
    """Skills the listing actually asks for first, then the candidate's most
    in-demand remaining skills so the resume is never near-empty for a terse
    listing. Only ever returns exact strings from the profile."""
    source_skills = profile.get("skills", [])
    cap = min(limit, len(source_skills))
    demand = demand or {}

    matched = [skill for skill in source_skills if term_in_text(skill, job_text_norm)]
    matched.sort(key=lambda skill: -demand.get(normalize(skill).strip(), 0))

    selected = list(dict.fromkeys(matched))[:cap]
    if len(selected) < cap:
        remaining = [skill for skill in source_skills if skill not in selected]
        remaining.sort(key=lambda skill: -demand.get(normalize(skill).strip(), 0))
        selected.extend(remaining[: cap - len(selected)])
    return selected


def score_highlight(highlight: str, job_tokens: set, job_text_norm: str, profile_skills: list) -> float:
    """Overlap with the listing, with skill terms weighted above prose words."""
    tokens = tokenize(highlight)
    if not tokens:
        return 0.0
    score = float(len(tokens & job_tokens))
    for skill in profile_skills:
        if term_in_text(skill, normalize(highlight)) and term_in_text(skill, job_text_norm):
            score += 2.5
    # Quantified bullets read better on a resume; nudge them up on ties.
    if re.search(r"\d", highlight):
        score += 0.4
    return score


def select_evidence(
    job,
    profile: dict,
    demand=None,
    max_experience: int = 3,
    max_highlights: int = 4,
    boosts: dict = None,
) -> dict:
    """Return the same shape the drafting step used to ask a model for:
    {"experience": [{"experience_index": int, "highlight_indices": [int]}],
     "skills": ["exact profile skill"]}"""
    job_text = f"{getattr(job, 'title', '')} {getattr(job, 'description', '')}"
    job_text_norm = normalize(job_text)
    job_tokens = tokenize(job_text)
    source_experience = profile.get("experience", [])
    profile_skills = profile.get("skills", [])

    scored_entries = []
    for index, entry in enumerate(source_experience):
        highlights = entry.get("highlights", [])
        if not highlights:
            continue
        scores = [
            score_highlight(text, job_tokens, job_text_norm, profile_skills)
            for text in highlights
        ]
        if boosts:
            # Bullets that were on resumes which got interviews win close calls.
            scores = [s + boosts.get((index, i), 0.0) if s > 0 else s for i, s in enumerate(scores)]
        ranked = sorted(range(len(highlights)), key=lambda i: (-scores[i], i))
        chosen = [i for i in ranked[:max_highlights] if scores[i] > 0]
        if not chosen:
            # Keep the role on the resume, but lead with its own strongest
            # lines rather than dropping an employer entirely.
            chosen = ranked[: min(2, len(highlights))]
        entry_score = sum(scores[i] for i in chosen)
        # Recency matters on a resume; index 0 is the current role.
        entry_score += max(0, len(source_experience) - index) * 0.5
        scored_entries.append({
            "experience_index": index,
            "highlight_indices": sorted(chosen),
            "score": entry_score,
        })

    if not scored_entries:
        return {"experience": [], "skills": select_skills(job_text_norm, profile)}

    scored_entries.sort(key=lambda item: -item["score"])
    kept = scored_entries[:max_experience]
    # Present in profile (reverse-chronological) order, not score order.
    kept.sort(key=lambda item: item["experience_index"])

    return {
        "experience": [
            {"experience_index": item["experience_index"], "highlight_indices": item["highlight_indices"]}
            for item in kept
        ],
        "skills": select_skills(job_text_norm, profile, demand),
    }

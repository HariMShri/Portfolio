"""What the market is actually asking for, accumulated from the listings
this agent already fetches and then throws away.

Every run reads thousands of descriptions purely to score them. This module
keeps the part worth remembering: how often each skill term is demanded, and
how that differs between all listings and the ones that clear the match bar.
It needs no model -- it is counting, not reasoning.

Two things use it:
- Resume Tailor orders skills by real demand instead of profile order.
- The report shows the gap list: terms employers ask for repeatedly that are
  not in profile.json at all.

Only aggregate term counts are stored -- never a title, company, URL or
description. The file is gitignored and, in CI, lives in the Actions cache.
"""
import json
import os
import re
from datetime import datetime, timezone

from .local_tailor import normalize, term_in_text

SCHEMA_VERSION = 1
MEMORY_FILENAME = "ats_memory.json"

# Terms worth tracking even when absent from the profile -- that absence is
# exactly what makes them interesting as a gap.
TECH_VOCAB = (
    "selenium", "playwright", "cypress", "appium", "rest assured", "postman", "jmeter",
    "api testing", "automation testing", "manual testing", "regression testing",
    "performance testing", "load testing", "security testing", "accessibility testing",
    "mobile testing", "etl testing", "database testing", "test automation",
    "test cases", "test plan", "test strategy", "defect tracking", "bug tracking",
    "sql", "python", "java", "javascript", "typescript", "c#", "dotnet",
    "junit", "testng", "pytest", "cucumber", "bdd", "tdd", "robot framework",
    "jenkins", "ci cd", "github actions", "gitlab", "docker", "kubernetes",
    "aws", "azure", "gcp", "linux", "git", "jira", "confluence", "agile", "scrum",
    "rest api", "graphql", "microservices", "soap", "json", "xml",
    "playwright python", "selenium webdriver", "page object model",
    "grafana", "kibana", "splunk", "datadog", "observability",
    "sdlc", "stlc", "qa process", "shift left", "test driven",
)

YEARS_RE = re.compile(r"(\d{1,2})\s*\+?\s*(?:to|-|–)?\s*\d{0,2}\s*(?:years|yrs|year)")


def _path(output_dir: str) -> str:
    return os.path.join(output_dir, MEMORY_FILENAME)


def load(output_dir: str) -> dict:
    path = _path(output_dir)
    if not os.path.exists(path):
        return empty_memory()
    try:
        with open(path, encoding="utf-8") as f:
            memory = json.load(f)
    except (OSError, json.JSONDecodeError):
        return empty_memory()
    if not isinstance(memory, dict) or memory.get("schema_version") != SCHEMA_VERSION:
        return empty_memory()
    memory.setdefault("terms", {})
    return memory


def empty_memory() -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "updated_at": None,
        "runs": 0,
        "jobs_seen": 0,
        "shortlisted_seen": 0,
        "years_mentions": {},
        "terms": {},
    }


def vocabulary(profile: dict) -> list:
    """Tracked terms: the market's common vocabulary plus everything already
    claimed on the profile, so demand and coverage are measured together."""
    terms = {normalize(term).strip() for term in TECH_VOCAB}
    terms.update(normalize(skill).strip() for skill in profile.get("skills", []))
    return sorted(term for term in terms if term)


def observe(jobs: list, shortlist: list, profile: dict, output_dir: str) -> dict:
    """Fold one run's listings into the stored counts. Counts are per listing
    (document frequency), so a term repeated ten times in one description
    still counts once -- that is what makes the numbers comparable."""
    memory = load(output_dir)
    terms = memory.setdefault("terms", {})
    shortlist_ids = {id(job) for job in shortlist}

    for job in jobs:
        text_norm = normalize(f"{getattr(job, 'title', '')} {getattr(job, 'description', '')}")
        if not text_norm.strip():
            continue
        is_shortlisted = id(job) in shortlist_ids
        for term in vocabulary(profile):
            if term_in_text(term, text_norm):
                record = terms.setdefault(term, {"jobs": 0, "shortlisted": 0})
                record["jobs"] += 1
                if is_shortlisted:
                    record["shortlisted"] += 1
        match = YEARS_RE.search(text_norm)
        if match:
            years = match.group(1)
            memory["years_mentions"][years] = memory["years_mentions"].get(years, 0) + 1

    memory["runs"] += 1
    memory["jobs_seen"] += len(jobs)
    memory["shortlisted_seen"] += len(shortlist)
    memory["updated_at"] = datetime.now(timezone.utc).isoformat()
    save(output_dir, memory)
    return memory


def save(output_dir: str, memory: dict) -> str:
    os.makedirs(output_dir, exist_ok=True)
    path = _path(output_dir)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(memory, f, indent=2, sort_keys=True)
    return path


def demand(memory: dict) -> dict:
    """term -> how many listings asked for it. Feeds skill ordering."""
    return {term: record.get("jobs", 0) for term, record in memory.get("terms", {}).items()}


def top_terms(memory: dict, limit: int = 15) -> list:
    counts = demand(memory)
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]


def gaps(memory: dict, profile: dict, limit: int = 10) -> list:
    """Frequently demanded terms absent from the profile -- the ATS gap list."""
    owned = {normalize(skill).strip() for skill in profile.get("skills", [])}
    missing = [
        (term, record.get("jobs", 0))
        for term, record in memory.get("terms", {}).items()
        if term not in owned and record.get("jobs", 0) > 0
    ]
    return sorted(missing, key=lambda item: (-item[1], item[0]))[:limit]


def summarize(memory: dict, profile: dict) -> str:
    """One safe-to-log line: counts only, no listing content."""
    if not memory.get("runs"):
        return "no listings observed yet"
    gap_terms = ", ".join(term for term, _ in gaps(memory, profile, 5)) or "none"
    return (
        f"{memory['jobs_seen']} listings across {memory['runs']} run(s); "
        f"tracking {len(memory.get('terms', {}))} terms; top gaps: {gap_terms}"
    )

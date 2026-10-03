"""Remotive's public remote-jobs API (https://remotive.com/api/remote-jobs).

Remote-only listings with each role's eligible locations stated in
``candidate_required_location``, which the Fit Analyst uses to keep only
roles open to candidates in India. Remotive asks API users to link back to
the listing (the job URL does) and to keep requests to a few a day -- one
run a day with a handful of queries is well inside that.
"""
import requests

from ..models import Job
from .careers import HEADERS, _strip_html

API_URL = "https://remotive.com/api/remote-jobs"


def fetch(category: str = "", search: str = "", limit: int = 50, timeout: int = 20) -> list[Job]:
    params = {"limit": limit}
    if category:
        params["category"] = category
    if search:
        params["search"] = search
    try:
        response = requests.get(API_URL, params=params, headers=HEADERS, timeout=timeout)
        if response.status_code != 200:
            return []
        items = response.json().get("jobs", [])
    except (requests.RequestException, ValueError):
        return []
    return [
        Job(
            title=item.get("title", ""),
            company=item.get("company_name", ""),
            location=f"Remote ({item.get('candidate_required_location') or 'location not stated'})",
            url=item.get("url", ""),
            source="remotive",
            description=_strip_html(item.get("description", "")),
            posted_date=item.get("publication_date"),
        )
        for item in items
    ]

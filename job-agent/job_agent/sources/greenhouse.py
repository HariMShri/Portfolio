"""Greenhouse job boards expose a public, documented, unauthenticated JSON API
intended for exactly this kind of read -- no ToS risk, no scraping.
https://developers.greenhouse.io/job-board.html
"""
import requests
from ..models import Job

API_URL = "https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true"


def fetch(board_token: str, timeout: int = 15) -> list[Job]:
    try:
        resp = requests.get(API_URL.format(board=board_token), timeout=timeout)
        if resp.status_code != 200:
            return []
        data = resp.json()
    except (requests.RequestException, ValueError):
        return []

    jobs = []
    for item in data.get("jobs", []):
        location = (item.get("location") or {}).get("name", "")
        jobs.append(Job(
            title=item.get("title", ""),
            company=board_token,
            location=location,
            url=item.get("absolute_url", ""),
            source="greenhouse",
            description=_strip_html(item.get("content", "")),
            posted_date=item.get("updated_at"),
        ))
    return jobs


def _strip_html(html: str) -> str:
    import re
    text = re.sub(r"<[^>]+>", " ", html or "")
    return re.sub(r"\s+", " ", text).strip()

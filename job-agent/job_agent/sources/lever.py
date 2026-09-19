"""Lever job boards also expose a public, documented, unauthenticated JSON API.
https://github.com/lever/postings-api
"""
import requests
from ..models import Job

API_URL = "https://api.lever.co/v0/postings/{board}?mode=json"


def fetch(board_token: str, timeout: int = 15) -> list[Job]:
    try:
        resp = requests.get(API_URL.format(board=board_token), timeout=timeout)
        if resp.status_code != 200:
            return []
        data = resp.json()
    except (requests.RequestException, ValueError):
        return []

    jobs = []
    for item in data:
        categories = item.get("categories", {}) or {}
        location = categories.get("location", "")
        desc_parts = [item.get("descriptionPlain", "")]
        for lst in item.get("lists", []) or []:
            desc_parts.append(lst.get("text", ""))
            desc_parts.append(" ".join(lst.get("content", "").split()) if isinstance(lst.get("content"), str) else "")
        jobs.append(Job(
            title=item.get("text", ""),
            company=board_token,
            location=location,
            url=item.get("hostedUrl", ""),
            source="lever",
            description=" ".join(p for p in desc_parts if p),
            posted_date=str(item.get("createdAt", "")),
        ))
    return jobs

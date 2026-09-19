"""For sources that can't be safely automated (Naukri), or any job you find
yourself and want scored/drafted the same way as auto-fetched ones. Add
entries to manual_jobs.json (see manual_jobs.example.json for the format)
and they'll flow through the same matcher + drafter pipeline.
"""
import json
import os
from ..models import Job


def fetch(path: str = "manual_jobs.json") -> list[Job]:
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        entries = json.load(f)

    jobs = []
    for e in entries:
        jobs.append(Job(
            title=e.get("title", ""),
            company=e.get("company", ""),
            location=e.get("location", ""),
            url=e.get("url", ""),
            source=e.get("source", "manual"),
            description=e.get("description", ""),
        ))
    return jobs

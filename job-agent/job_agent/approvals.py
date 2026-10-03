"""Approval requests the agents send you on their own.

The daily digest carries signed **Submit for me / Fill only / Skip** links
for each job the Applicant can apply to. Clicking one opens a confirmation
page on the portfolio's Cloudflare Worker; pressing its button records the
decision. The runner then copies decisions into Neon, where `apply.py`
picks them up. Nothing is ever submitted from a click alone: apply.py still
re-checks the approval against the exact content before it acts.

Links are signed with HMAC-SHA256 using the runner's existing
STATUS_API_TOKEN (the Worker's JOB_STATUS_TOKEN), matching
``ai-worker/src/approvals.js``.
"""
import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional
from urllib.parse import quote, urlparse

LINK_LIFETIME = 3 * 24 * 3600  # how long the email buttons work
SCOPES = ("submit", "fill", "skip")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def sign_token(payload: dict, key: str) -> str:
    body = _b64url(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    signature = hmac.new(key.encode("utf-8"), f"approval-v1.{body}".encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64url(signature)}"


def approved_cover_note(job: dict) -> str:
    """The cover note an approval covers: only one that passed the fact check."""
    review = job.get("cover_review") or {}
    note = (job.get("draft_cover_note") or "").strip()
    return note if note and review.get("passed") else ""


def content_hash(job: dict) -> str:
    """What exactly is being approved: the form, the resume selection and the
    cover note. apply.py recomputes this before acting; any difference blocks."""
    from .applicant import destination_for

    destination = destination_for(job) or {}
    material = {
        "job_id": job.get("job_id"),
        "form_url": destination.get("form_url", ""),
        "resume": job.get("draft_resume"),
        "cover_note": approved_cover_note(job),
    }
    return hashlib.sha256(json.dumps(material, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def worker_base(status_url: str) -> str:
    parsed = urlparse(status_url or "")
    return f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""


def credentials() -> tuple[str, str]:
    """(worker base URL, signing key) from the runner's status settings."""
    return worker_base(os.environ.get("STATUS_API_URL", "").strip()), os.environ.get("STATUS_API_TOKEN", "").strip()


def approval_links(job: dict, base: str, key: str, now: Optional[float] = None) -> dict:
    """scope -> signed link for one job; empty when approvals can't be offered."""
    if not base or not key or not job.get("draft_resume"):
        return {}
    expires = int((now or time.time()) + LINK_LIFETIME)
    digest = content_hash(job)
    links = {}
    for scope in SCOPES:
        payload = {"j": job["job_id"], "s": scope, "c": digest, "e": expires,
                   "t": (job.get("title") or "")[:120], "o": (job.get("company") or "")[:80]}
        links[scope] = f"{base}/approve?t={quote(sign_token(payload, key))}"
    return links


def fetch_recorded(base: str, key: str, timeout: int = 15) -> list[dict]:
    """Decisions recorded on the Worker since they were last pulled."""
    import requests

    response = requests.get(f"{base}/internal/approvals", headers={"Authorization": f"Bearer {key}"}, timeout=timeout)
    if response.status_code != 200:
        raise RuntimeError(f"approvals endpoint returned {response.status_code}")
    return response.json().get("approvals", [])


def sync(store, base: Optional[str] = None, key: Optional[str] = None) -> tuple[int, int]:
    """Copy recorded decisions into Neon. Skips become a 'skipped' outcome.
    Returns (new approvals, new skips)."""
    from .outcomes import Outcome

    if base is None or key is None:
        base, key = credentials()
    if not base or not key:
        return 0, 0
    new_approvals = new_skips = 0
    for record in fetch_recorded(base, key):
        if record.get("scope") not in SCOPES or not record.get("job_id"):
            continue
        if not store.upsert_approval(record):
            continue
        if record["scope"] == "skip":
            new_skips += 1
            job = store.latest_job(record["job_id"]) or {}
            outcome = Outcome(job_id=record["job_id"], company=job.get("company", ""), title=job.get("title", ""),
                              decision="skipped", note="Skipped from the digest email",
                              recorded_at=record["approved_at"])
            store.add_outcome(outcome.__dict__)
        else:
            new_approvals += 1
    return new_approvals, new_skips

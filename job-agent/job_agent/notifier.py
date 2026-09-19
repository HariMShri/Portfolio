"""Sends the daily digest email via Resend (https://resend.com). Uses their
shared `onboarding@resend.dev` sending address by default, which works
without verifying your own domain -- fine for a personal reminder email to
yourself. Requires RESEND_API_KEY as an env var; if it's not set, this just
skips sending and logs why, same graceful-degradation pattern as the sources.
"""
import os
from datetime import datetime
from .models import Job
from .report import render_html


def _summary_html(jobs: list[Job], profile: dict) -> str:
    if not jobs:
        return f"""
        <p>No new matches cleared the bar today. The agent ran fine -- there just
        wasn't a QA/test-engineering role today that scored well against your profile.</p>
        <p>This is expected on plenty of days; it's a signal the filter is being honest
        rather than padding the list.</p>
        """
    top = jobs[:8]
    rows = []
    for j in top:
        link_html = f' &mdash; <a href="{j.url}">listing</a>' if j.url else ""
        rows.append(
            f'<li style="margin-bottom:8px"><strong>{j.title}</strong> at {j.company} '
            f'&mdash; {j.location} ({j.match_score:.0f} match){link_html}</li>'
        )
    rows = "".join(rows)
    more = f"<p>...and {len(jobs) - len(top)} more in the attached full report.</p>" if len(jobs) > len(top) else ""
    return f"""
    <p>{len(jobs)} job(s) matched today. Top ones:</p>
    <ul>{rows}</ul>
    {more}
    <p>Full drafted cover notes and Q&amp;A are in the attached HTML report.
    Nothing has been submitted anywhere &mdash; review before applying.</p>
    """


def send_digest(jobs: list[Job], profile: dict, config: dict) -> bool:
    notify_cfg = config.get("notify", {})
    if not notify_cfg.get("enabled"):
        return False
    if not jobs and not notify_cfg.get("always_send", True):
        print("  [notifier] no matches and always_send is false -- skipping email")
        return False

    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        print("  [notifier] RESEND_API_KEY not set -- skipping email send")
        return False

    try:
        import requests
    except ImportError:
        print("  [notifier] requests not installed -- skipping email send")
        return False

    date_str = datetime.now().strftime("%Y-%m-%d")
    subject = f"Job search digest: {len(jobs)} match(es) -- {date_str}" if jobs else f"Job search digest: no matches today -- {date_str}"

    body_html = f"""
    <html><body style="font-family: sans-serif; max-width: 640px; margin: 0 auto;">
    <h2>Daily Job Search Digest</h2>
    <p style="color:#666; font-size:0.85em">{date_str}</p>
    {_summary_html(jobs, profile)}
    </body></html>
    """

    full_report_html = render_html(jobs, profile)

    payload = {
        "from": notify_cfg.get("from_email", "Job Search Agent <onboarding@resend.dev>"),
        "to": [notify_cfg.get("to_email")],
        "subject": subject,
        "html": body_html,
        "attachments": [{
            "filename": f"job_report_{date_str}.html",
            "content": _b64(full_report_html),
        }],
    }

    try:
        resp = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=20,
        )
        if resp.status_code >= 300:
            print(f"  [notifier] Resend API returned {resp.status_code}: {resp.text[:300]}")
            return False
        print(f"  [notifier] digest emailed to {notify_cfg.get('to_email')}")
        return True
    except requests.RequestException as e:
        print(f"  [notifier] send failed: {e}")
        return False


def _b64(text: str) -> str:
    import base64
    return base64.b64encode(text.encode("utf-8")).decode("ascii")

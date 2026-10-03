"""Sends the daily digest email via Resend (https://resend.com). Uses their
shared `onboarding@resend.dev` sending address by default, which works
without verifying your own domain -- fine for a personal reminder email to
yourself. Requires RESEND_API_KEY as an env var; if it's not set, this just
skips sending and logs why, same graceful-degradation pattern as the sources.
"""
import glob
import os
from datetime import datetime
from .models import Job


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
    <p>Full drafted cover notes and Q&amp;A are in the attached PDF report, and each
    tailored resume is attached as its own PDF, named after the company and role.
    Nothing has been submitted anywhere &mdash; review before applying.</p>
    """


def send_digest(jobs: list[Job], profile: dict, config: dict, pdf_path: str) -> bool:
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

    try:
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()
    except OSError as e:
        print(f"  [notifier] couldn't read PDF report at {pdf_path}, sending without attachment: {e}")
        pdf_bytes = None

    payload = {
        "from": notify_cfg.get("from_email", "Job Search Agent <onboarding@resend.dev>"),
        "to": [notify_cfg.get("to_email")],
        "subject": subject,
        "html": body_html,
    }
    attachments = []
    if pdf_bytes is not None:
        attachments.append({"filename": f"job_report_{date_str}.pdf", "content": _b64_bytes(pdf_bytes)})
    attachments += _resume_attachments(pdf_path, profile)
    if attachments:
        payload["attachments"] = attachments

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
        resumes = max(0, len(attachments) - (pdf_bytes is not None))
        print(f"  [notifier] digest emailed to {notify_cfg.get('to_email')} with {resumes} tailored resume PDF(s)")
        return True
    except requests.RequestException as e:
        print(f"  [notifier] send failed: {e}")
        return False


def _b64_bytes(data: bytes) -> str:
    import base64
    return base64.b64encode(data).decode("ascii")


def _resume_attachments(pdf_path: str, profile: dict) -> list[dict]:
    """Tailored resume PDFs written beside the report by the same run.

    The report is ``report_<timestamp>.pdf``; its resumes are
    ``resume_<timestamp>_<n>_<company>_<role>.pdf``. Attached as
    ``Resume_<Name>_<company>_<role>.pdf`` so each is ready to send on.
    """
    folder, report_name = os.path.split(pdf_path or "")
    if not report_name.startswith("report_") or not report_name.endswith(".pdf"):
        return []
    timestamp = report_name[len("report_"):-len(".pdf")]
    owner = "".join(ch for ch in profile.get("name", "") if ch.isalnum()) or "Candidate"
    attachments = []
    for path in sorted(glob.glob(os.path.join(folder or ".", f"resume_{timestamp}_*.pdf"))):
        # Drop the "resume_<date>_<time>_<n>_" prefix, keep "<company>_<role>".
        role_part = os.path.basename(path)[:-len(".pdf")].split("_", 4)[-1]
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError as e:
            print(f"  [notifier] couldn't read a resume PDF, skipping it: {type(e).__name__}")
            continue
        attachments.append({"filename": f"Resume_{owner}_{role_part}.pdf", "content": _b64_bytes(data)})
    return attachments

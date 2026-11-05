"""Sends the daily digest email through Brevo's transactional email API
(https://developers.brevo.com/reference/sendtransacemail). Needs
``BREVO_API_KEY`` (an ``xkeysib-...`` key from app.brevo.com -> SMTP & API ->
API Keys) as an env var.

``notify.from_email`` must be a sender verified in Brevo. ``notify.to_email``
is you and gets the approval buttons; ``notify.share_with`` (a list) gets the
same job list and PDFs without them, one email each so nobody sees the other
recipients. If the key is missing this just skips sending and logs why, same
graceful-degradation pattern as the sources.
"""
import glob
import os
from email.utils import parseaddr
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
    import html as html_lib

    # New jobs first, then by score -- yesterday's matches are already in yesterday's email.
    top = sorted(jobs, key=lambda j: (not j.is_new, -j.match_score))[:10]
    rows = []
    for j in top:
        link_html = f' &mdash; <a href="{html_lib.escape(j.url)}">listing</a>' if j.url else ""
        tags = "".join(f' <span style="color:#1e7d32;font-weight:700">{tag}</span>' for tag in (
            "NEW" if j.is_new else "", "REMOTE" if j.work_mode.startswith("remote") else "") if tag)
        rows.append(
            f'<li style="margin-bottom:8px"><strong>{html_lib.escape(j.title)}</strong> at {html_lib.escape(j.company)}'
            f'{tags} &mdash; {html_lib.escape(j.location)} ({j.match_score:.0f} match){link_html}</li>'
        )
    rows = "".join(rows)
    more = f"<p>...and {len(jobs) - len(top)} more in the attached full report.</p>" if len(jobs) > len(top) else ""
    new_count = sum(j.is_new for j in jobs)
    remote_count = sum(j.work_mode.startswith("remote") for j in jobs)
    return f"""
    <p>{len(jobs)} job(s) matched today &mdash; {new_count} new, {remote_count} remote. Top ones:</p>
    <ul>{rows}</ul>
    {more}
    <p>Full drafted cover notes and Q&amp;A are in the attached PDF report, and each
    tailored resume is attached as its own PDF, named after the company and role.
    Nothing has been submitted anywhere &mdash; review before applying.</p>
    """


def _approvals_html(jobs: list[Job], links: dict) -> str:
    """The agents asking you, per job, whether to apply. Each button opens a
    confirmation page; nothing is recorded until you press its button there."""
    import html as html_lib

    rows = []
    for job in jobs:
        job_links = (links or {}).get(job.job_id)
        if not job_links:
            continue
        button = ('<a href="{href}" style="display:inline-block;margin:4px 6px 0 0;padding:8px 14px;border-radius:999px;'
                  'background:{bg};color:{fg};text-decoration:none;font-weight:600;font-size:13px">{label}</a>')
        buttons = "".join(button.format(href=html_lib.escape(job_links[scope]), bg=bg, fg=fg, label=label) for scope, bg, fg, label in (
            ("submit", "#1e7d32", "#ffffff", "Submit for me"),
            ("fill", "#e8eef5", "#1a1a1a", "Fill only, I'll submit"),
            ("skip", "#f4f4f4", "#555555", "Skip"),
        ))
        note = "Cover note attached" if (job.cover_review or {}).get("passed") else "No cover note (none passed the fact check)"
        rows.append(
            f'<li style="margin-bottom:16px"><strong>{html_lib.escape(job.title)}</strong> at {html_lib.escape(job.company)}'
            f' ({job.match_score:.0f} match) &middot; <a href="{html_lib.escape(job.url)}">listing</a><br>'
            f'<span style="color:#666;font-size:12px">Tailored resume attached &middot; {note}</span><br>{buttons}</li>'
        )
    if not rows:
        return ""
    return f"""
    <h3 style="margin-top:28px">Waiting for your approval</h3>
    <p style="color:#555;font-size:14px">These have application forms the Applicant can fill. Review the attached
    resume and the cover note in the report, then choose. Approvals last 48 hours and are carried out the next
    time you run <code>python apply.py</code> on your PC. Questions only you can answer are always left to you.</p>
    <ul style="padding-left:18px">{''.join(rows)}</ul>
    """


def send_digest(jobs: list[Job], profile: dict, config: dict, pdf_path: str, approval_links: dict = None) -> bool:
    notify_cfg = config.get("notify", {})
    if not notify_cfg.get("enabled"):
        return False
    if not jobs and not notify_cfg.get("always_send", True):
        print("  [notifier] no matches and always_send is false -- skipping email")
        return False

    api_key = os.environ.get("BREVO_API_KEY")
    if not api_key:
        print("  [notifier] BREVO_API_KEY not set -- skipping email send")
        return False

    try:
        import requests
    except ImportError:
        print("  [notifier] requests not installed -- skipping email send")
        return False

    # to_email is you: the only recipient who gets the approval buttons.
    # share_with get the same job list and PDFs, but no way to approve.
    owner = _addresses(notify_cfg.get("to_email"))
    shared = [a for a in _addresses(notify_cfg.get("share_with")) if a.lower() not in {o.lower() for o in owner}]
    if not owner and not shared:
        print("  [notifier] notify.to_email and notify.share_with are empty -- skipping email send")
        return False

    from_name, from_addr = parseaddr(notify_cfg.get("from_email", ""))
    if not from_addr:
        print("  [notifier] notify.from_email is not set -- skipping email send")
        return False

    date_str = datetime.now().strftime("%Y-%m-%d")
    subject = f"Job search digest: {len(jobs)} match(es) -- {date_str}" if jobs else f"Job search digest: no matches today -- {date_str}"

    try:
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()
    except OSError as e:
        print(f"  [notifier] couldn't read PDF report at {pdf_path}, sending without attachment: {e}")
        pdf_bytes = None

    attachments = []
    if pdf_bytes is not None:
        attachments.append({"name": f"job_report_{date_str}.pdf", "content": _b64_bytes(pdf_bytes)})
    attachments += _resume_attachments(pdf_path, profile)

    def payload(to: list[str], with_approvals: bool) -> dict:
        body = {
            "sender": {"name": from_name or "Job Search Agent", "email": from_addr},
            "to": [{"email": addr} for addr in to],
            "subject": subject,
            "htmlContent": f"""
            <html><body style="font-family: sans-serif; max-width: 640px; margin: 0 auto;">
            <h2>Daily Job Search Digest</h2>
            <p style="color:#666; font-size:0.85em">{date_str}</p>
            {_summary_html(jobs, profile)}
            {_approvals_html(jobs, approval_links) if with_approvals else ""}
            </body></html>
            """,
        }
        if attachments:
            body["attachment"] = attachments
        return body

    # One email for you (with approvals), then one per shared recipient (without).
    sends = ([(owner, True)] if owner else []) + [([addr], False) for addr in shared]
    delivered = []
    for to, with_approvals in sends:
        try:
            resp = requests.post(
                "https://api.brevo.com/v3/smtp/email",
                headers={"api-key": api_key, "accept": "application/json", "content-type": "application/json"},
                json=payload(to, with_approvals),
                timeout=30,
            )
        except requests.RequestException as e:
            print(f"  [notifier] send to {', '.join(to)} failed: {type(e).__name__}")
            continue
        if resp.status_code >= 300:
            print(f"  [notifier] Brevo API returned {resp.status_code} for {', '.join(to)}: {resp.text[:300]}")
            continue
        delivered += [a if with_approvals else f"{a} (no approvals)" for a in to]

    if not delivered:
        return False
    resumes = max(0, len(attachments) - (pdf_bytes is not None))
    print(f"  [notifier] digest emailed to {', '.join(delivered)} with {resumes} tailored resume PDF(s)")
    return True


def _b64_bytes(data: bytes) -> str:
    import base64
    return base64.b64encode(data).decode("ascii")


def _addresses(value) -> list[str]:
    """One address, a comma-separated string, or a list -> clean list."""
    if not value:
        return []
    if isinstance(value, str):
        value = value.split(",")
    return [addr.strip() for addr in value if addr and addr.strip()]


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
        attachments.append({"name": f"Resume_{owner}_{role_part}.pdf", "content": _b64_bytes(data)})
    return attachments

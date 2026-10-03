"""Applicant: submits applications on the user's behalf, one approved job at a time.

Scope is deliberately narrow:

* Only Greenhouse and Lever hosted application forms. These are ordinary
  public forms each employer publishes for candidates. LinkedIn, Indeed and
  Naukri prohibit automated applications and ban accounts that use them, so
  jobs from those sources are prepared (tailored resume PDF + cover letter)
  and opened for the user to submit themselves -- never automated.
* Every submission needs its own approval record (WORKFLOW.md, "Submission"):
  job ID, destination URL, SHA-256 of each file to upload, scope, approver,
  approval time and expiry. Any change to a file or destination, an expired
  approval, or a closed listing blocks the action. Approval for one job never
  carries to another.
* Only facts from profile.json are entered. Custom employer questions,
  demographic surveys and CAPTCHAs are never answered or bypassed: the form is
  left open in a visible browser for the user to finish.

Everything written here (packages, approvals, attempt log) lives under the
gitignored ``output/`` directory and never leaves the machine except as the
application the user approved.
"""
import hashlib
import json
import os
import re
import time
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import parse_qs, urlparse

from .models import Job

APPROVALS_FILENAME = "approvals.jsonl"
ATTEMPTS_FILENAME = "applications.jsonl"
PACKAGES_DIRNAME = "applications"
APPROVAL_TTL = timedelta(hours=24)
SCOPES = ("submit", "fill")
NO_AUTOMATION_REASON = {
    "linkedin": "LinkedIn prohibits automated applications",
    "indeed": "Indeed prohibits automated applications",
    "naukri": "Naukri prohibits automated applications",
    "workday": "Workday applications need a candidate account, and the agent never logs in for you",
    "remotive": "Remotive links out to each employer's own application page",
}
ANSWERS_FILENAME = "application_answers.json"

CONFIRMATION_PATTERN = re.compile(
    r"thank you for (applying|your application|your interest)|application (has been |was )?(submitted|received)"
    r"|we('ve| have) received your application",
    re.I,
)


class PackageError(Exception):
    """The job can't be packaged (no verifiable resume evidence for it)."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def split_name(profile: dict) -> tuple[str, str]:
    """First/last name for forms. Explicit profile fields win; otherwise the
    final word is the surname ("Shri Hari M" -> "Shri Hari", "M")."""
    if profile.get("first_name") and profile.get("last_name"):
        return profile["first_name"], profile["last_name"]
    parts = (profile.get("name") or "").split()
    if len(parts) < 2:
        return (parts[0] if parts else ""), ""
    return " ".join(parts[:-1]), parts[-1]


def _owner(profile: dict) -> str:
    return "".join(ch for ch in profile.get("name", "") if ch.isalnum()) or "Candidate"


# ---------- destinations ----------

def destination_for(job: dict) -> Optional[dict]:
    """Where an automated application can go, or None if it can't.

    Greenhouse listings often link to the employer's own careers page, so the
    form is addressed through Greenhouse's embed URL for that board and post.
    """
    url = job.get("url") or ""
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    segments = [segment for segment in parsed.path.split("/") if segment]

    board = posting = None
    if host.endswith("greenhouse.io"):
        # boards.greenhouse.io/<board>/jobs/<id> or job-boards.greenhouse.io/<board>/jobs/<id>
        if len(segments) >= 3 and segments[1] == "jobs":
            board, posting = segments[0], segments[2]
    if not posting and job.get("source") == "greenhouse":
        board = job.get("company") or ""
        posting = parse_qs(parsed.query).get("gh_jid", [None])[0]
        if not posting:
            numeric = [segment for segment in segments if segment.isdigit()]
            posting = numeric[-1] if numeric else None
    if board and posting and str(posting).isdigit() and re.fullmatch(r"[A-Za-z0-9_-]+", board):
        return {
            "platform": "greenhouse",
            "form_url": f"https://job-boards.greenhouse.io/embed/job_app?for={board}&token={posting}",
            "check_url": f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{posting}",
        }

    if host == "jobs.lever.co" and len(segments) >= 2:
        company, posting = segments[0], segments[1]
        if re.fullmatch(r"[A-Za-z0-9_-]+", company) and re.fullmatch(r"[0-9a-fA-F-]{36}", posting):
            return {
                "platform": "lever",
                "form_url": f"https://jobs.lever.co/{company}/{posting}/apply",
                "check_url": f"https://api.lever.co/v0/postings/{company}/{posting}",
            }
    return None


def manual_reason(job: dict) -> str:
    return NO_AUTOMATION_REASON.get(job.get("source", ""), "This listing has no supported application form")


def listing_open(destination: dict, timeout: int = 15) -> bool:
    """The posting still exists on the employer's board."""
    import requests
    try:
        return requests.get(destination["check_url"], timeout=timeout).status_code == 200
    except requests.RequestException:
        return False


# ---------- packages ----------

@dataclass
class Package:
    job_id: str
    title: str
    company: str
    source: str
    listing_url: str
    destination: Optional[dict]
    folder: str
    files: dict
    cover_note: str = ""

    def hashes(self) -> dict:
        return {name: sha256_file(path) for name, path in self.files.items()}


def job_from_dict(data: dict) -> Job:
    known = {f.name for f in fields(Job)}
    return Job(**{key: value for key, value in data.items() if key in known})


def _usable_cover_note(job: Job, profile: dict) -> str:
    """Only a note that passed the Application Reviewer's fact check is sent."""
    from .reviewer import review_cover_note

    note = (job.draft_cover_note or "").strip()
    if not note or note.startswith("[Drafting failed"):
        return ""
    review = job.cover_review or review_cover_note(job, profile)
    return note if review.get("passed") else ""


def render_cover_letter_pdf(job: Job, profile: dict, note: str, out_path: str) -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    import html

    doc = SimpleDocTemplate(out_path, pagesize=A4, leftMargin=56, rightMargin=56, topMargin=56, bottomMargin=56,
                            title=f"{profile.get('name', '')} - Cover Letter", author=profile.get("name", ""))
    name_style = ParagraphStyle("Name", fontName="Helvetica-Bold", fontSize=16, leading=20)
    meta_style = ParagraphStyle("Meta", fontName="Helvetica", fontSize=9, leading=12, textColor=colors.HexColor("#555555"))
    body_style = ParagraphStyle("Body", fontName="Helvetica", fontSize=10.5, leading=15, spaceAfter=10)
    contact = " | ".join(html.escape(v) for v in (profile.get("email", ""), profile.get("phone", ""),
                                                   profile.get("linkedin_url", "")) if v)
    story = [Paragraph(html.escape(profile.get("name", "")), name_style), Paragraph(contact, meta_style), Spacer(1, 18),
             Paragraph(f"Re: {html.escape(job.title)} at {html.escape(job.company)}", body_style)]
    story += [Paragraph(html.escape(part.strip()), body_style) for part in note.split("\n\n") if part.strip()]
    story.append(Paragraph(f"Regards,<br/>{html.escape(profile.get('name', ''))}", body_style))
    doc.build(story)


def build_package(job_data: dict, profile: dict, output_dir: str = "output",
                  demand: Optional[dict] = None, include_cover_letter: bool = True,
                  rebuild: bool = False) -> Package:
    """Tailored resume PDF (and cover letter PDF when a usable draft exists)
    for one job. An existing package is reused so an approval made earlier
    still matches the exact files it hashed."""
    from .report import render_resume_pdf
    from .resume_tailor import tailor_resume_for_job
    from .reviewer import review_resume_drafts

    job = job_from_dict(job_data)
    folder = os.path.join(output_dir, PACKAGES_DIRNAME, job.job_id)
    manifest = os.path.join(folder, "package.json")
    if not rebuild and os.path.exists(manifest):
        with open(manifest, encoding="utf-8") as f:
            data = json.load(f)
        if all(os.path.exists(path) for path in data["files"].values()):
            return Package(**data)

    if not (job.draft_resume and job.resume_review and job.resume_review.get("passed")):
        tailor_resume_for_job(job, profile, demand)
        review_resume_drafts([job], profile)
    if not (job.draft_resume and job.resume_review and job.resume_review.get("passed")):
        raise PackageError("no resume draft for this job passed evidence review")

    os.makedirs(folder, exist_ok=True)
    owner = _owner(profile)
    files = {"resume": os.path.join(folder, f"{owner}_Resume.pdf")}
    render_resume_pdf(job, profile, files["resume"])
    note = _usable_cover_note(job, profile) if include_cover_letter else ""
    if note:
        files["cover_letter"] = os.path.join(folder, f"{owner}_Cover_Letter.pdf")
        render_cover_letter_pdf(job, profile, note, files["cover_letter"])

    package = Package(
        job_id=job.job_id, title=job.title, company=job.company, source=job.source,
        listing_url=job.url, destination=destination_for(job_data), folder=folder, files=files, cover_note=note,
    )
    with open(manifest, "w", encoding="utf-8") as f:
        json.dump(asdict(package), f, indent=2)
    return package


# ---------- approvals ----------

@dataclass
class Approval:
    job_id: str
    destination: str
    artifacts: dict
    scope: str
    approver: str
    approved_at: str
    expires_at: str
    schema_version: int = 1


def _append(output_dir: str, filename: str, record: dict) -> None:
    os.makedirs(output_dir, exist_ok=True)
    with open(os.path.join(output_dir, filename), "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def _read(output_dir: str, filename: str) -> list[dict]:
    path = os.path.join(output_dir, filename)
    if not os.path.exists(path):
        return []
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return records


def approve(output_dir: str, package: Package, scope: str, approver: str, now: Optional[datetime] = None) -> Approval:
    if scope not in SCOPES:
        raise ValueError(f"scope must be one of {SCOPES}")
    if not package.destination:
        raise ValueError("this job has no automatable destination to approve")
    now = now or _now()
    approval = Approval(
        job_id=package.job_id, destination=package.destination["form_url"], artifacts=package.hashes(),
        scope=scope, approver=approver, approved_at=now.isoformat(), expires_at=(now + APPROVAL_TTL).isoformat(),
    )
    _append(output_dir, APPROVALS_FILENAME, asdict(approval))
    return approval


def latest_approval(output_dir: str, job_id: str) -> Optional[dict]:
    matches = [record for record in _read(output_dir, APPROVALS_FILENAME) if record.get("job_id") == job_id]
    return matches[-1] if matches else None


def approval_problems(approval: Optional[dict], package: Package, now: Optional[datetime] = None) -> list[str]:
    """Everything that blocks acting on this approval. Empty means go."""
    if not approval:
        return ["no approval recorded for this job"]
    problems = []
    now = now or _now()
    if approval.get("job_id") != package.job_id:
        problems.append("approval is for a different job")
    if approval.get("scope") not in SCOPES:
        problems.append("approval scope is not recognised")
    try:
        if datetime.fromisoformat(approval["expires_at"]) <= now:
            problems.append("approval has expired")
    except (KeyError, ValueError):
        problems.append("approval has no valid expiry")
    if not package.destination or approval.get("destination") != package.destination.get("form_url"):
        problems.append("destination changed since approval")
    try:
        current = package.hashes()
    except OSError:
        problems.append("an approved file is missing")
    else:
        if current != approval.get("artifacts"):
            problems.append("files changed since approval")
    return problems


# ---------- the browser step ----------

@dataclass
class Attempt:
    job_id: str
    platform: str
    status: str  # submitted | filled | needs_you | unconfirmed | blocked | submitted_by_user
    detail: str = ""
    blockers: list = field(default_factory=list)
    at: str = field(default_factory=lambda: _now().isoformat())


def log_attempt(output_dir: str, attempt: Attempt) -> None:
    _append(output_dir, ATTEMPTS_FILENAME, asdict(attempt))
    from .store import push
    push("application", asdict(attempt))


FIELD_SELECTORS = {
    "greenhouse": {
        "first_name": ["#first_name", "input[name='job_application[first_name]']", "input[autocomplete='given-name']"],
        "last_name": ["#last_name", "input[name='job_application[last_name]']", "input[autocomplete='family-name']"],
        "email": ["#email", "input[name='job_application[email]']", "input[type='email']"],
        "phone": ["#phone", "input[name='job_application[phone]']", "input[type='tel']"],
        "resume": ["input[type='file']#resume", "#resume input[type='file']", "input[type='file'][id*='resume' i]",
                   "input[type='file'][name*='resume' i]"],
        "cover_letter": ["input[type='file']#cover_letter", "#cover_letter input[type='file']",
                         "input[type='file'][id*='cover' i]", "input[type='file'][name*='cover' i]"],
        "submit": ["#submit_app", "button[type='submit']", "input[type='submit']"],
    },
    "lever": {
        "full_name": ["input[name='name']"],
        "email": ["input[name='email']"],
        "phone": ["input[name='phone']"],
        "company": ["input[name='org']"],
        "linkedin": ["input[name='urls[LinkedIn]']"],
        "github": ["input[name='urls[GitHub]']"],
        "portfolio": ["input[name='urls[Portfolio]']", "input[name='urls[Other]']"],
        "resume": ["input[type='file'][name='resume']", "#resume-upload-input"],
        "comments": ["textarea[name='comments']"],
        "submit": ["#btn-submit", "button[type='submit']"],
    },
}

# Link fields on Greenhouse forms are custom questions identified only by label.
LABELLED_LINKS = (
    (r"linked\s*in", "linkedin_url"),
    (r"git\s*hub", "github_url"),
    (r"portfolio|personal (web)?site|^website", "portfolio_url"),
)

UNFILLED_REQUIRED_JS = """
() => Array.from(document.querySelectorAll('input, select, textarea')).filter((el) => {
  if (el.type === 'hidden' || el.type === 'submit' || el.disabled) return false;
  const required = el.required || el.getAttribute('aria-required') === 'true';
  if (!required) return false;
  const shown = el.type === 'file' || el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
  if (!shown) return false;
  if (el.type === 'checkbox' || el.type === 'radio') {
    const group = el.name ? document.querySelectorAll(`[name="${CSS.escape(el.name)}"]`) : [el];
    return !Array.from(group).some((item) => item.checked);
  }
  if (el.type === 'file') return el.files.length === 0;
  return !String(el.value || '').trim();
}).map((el) => {
  const label = (el.labels && el.labels[0] && el.labels[0].innerText)
    || el.getAttribute('aria-label') || el.name || el.id || 'unnamed field';
  return label.replace(/\\s+/g, ' ').replace(/\\*$/, '').trim().slice(0, 90);
})
"""

CAPTCHA_JS = """
() => Array.from(document.querySelectorAll(
  "iframe[src*='hcaptcha'], iframe[title='reCAPTCHA'], iframe[src*='recaptcha/api2/bframe'], iframe[title*='challenge' i]"
)).some((frame) => { const r = frame.getBoundingClientRect(); return r.width > 30 && r.height > 30; })
"""


def _first(page, selectors):
    for selector in selectors:
        locator = page.locator(selector)
        try:
            if locator.count():
                return locator.first
        except Exception:
            continue
    return None


def _fill(page, selectors, value) -> bool:
    if not value:
        return False
    target = _first(page, selectors)
    if target is None:
        return False
    try:
        if not target.is_visible() or not target.is_editable():
            return False
        if not target.input_value().strip():
            target.fill(value)
        return True
    except Exception:
        return False


def _upload(page, selectors, path) -> bool:
    target = _first(page, selectors)
    if target is None or not path:
        return False
    try:
        target.set_input_files(path)
        return True
    except Exception:
        return False


def _fill_labelled_links(page, profile: dict) -> None:
    for pattern, key in LABELLED_LINKS:
        value = profile.get(key)
        if not value:
            continue
        try:
            fields_found = page.get_by_label(re.compile(pattern, re.I))
            for index in range(fields_found.count()):
                item = fields_found.nth(index)
                kind = (item.get_attribute("type") or "text").lower()
                if kind in ("text", "url") and item.is_visible() and item.is_editable() and not item.input_value().strip():
                    item.fill(value)
        except Exception:
            continue


def load_answers(path: str = ANSWERS_FILENAME) -> list[dict]:
    """Your own answers to questions employers repeat (notice period, work
    authorisation, relocation...). Kept in a gitignored file because the repo
    is public. Each entry: {"question": "<regex matched against the field
    label>", "answer": "<exact text or option to choose>"}."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    entries = data.get("answers", []) if isinstance(data, dict) else data
    return [e for e in entries if isinstance(e, dict) and e.get("question") and e.get("answer")]


def _fill_answer_bank(page, answers: list[dict]) -> list[str]:
    """Answer only questions you have answered yourself, matched by label."""
    answered = []
    for entry in answers:
        try:
            fields_found = page.get_by_label(re.compile(entry["question"], re.I))
            for index in range(fields_found.count()):
                item = fields_found.nth(index)
                if not item.is_visible() or not item.is_enabled():
                    continue
                tag = item.evaluate("el => el.tagName.toLowerCase()")
                kind = (item.get_attribute("type") or "").lower()
                if tag == "select":
                    if not item.input_value():
                        item.select_option(label=str(entry["answer"]))
                        answered.append(entry["question"])
                elif tag == "textarea" or kind in ("", "text", "number", "url", "tel"):
                    if not item.input_value().strip():
                        item.fill(str(entry["answer"]))
                        answered.append(entry["question"])
                elif kind in ("radio", "checkbox"):
                    continue
        except Exception:
            continue
    return answered


LOGIN_WALL_JS = """
() => Array.from(document.querySelectorAll("input[type='password']"))
  .some((el) => el.offsetWidth > 0 || el.offsetHeight > 0)
"""


def fill_form(page, package: Package, profile: dict, answers: Optional[list] = None) -> list[str]:
    """Enter profile facts and attach the approved files. Returns what was filled."""
    platform = package.destination["platform"]
    selectors = FIELD_SELECTORS[platform]
    filled = []
    first, last = split_name(profile)
    if platform == "greenhouse":
        values = {"first_name": first, "last_name": last, "email": profile.get("email"), "phone": profile.get("phone")}
        for key, value in values.items():
            if _fill(page, selectors[key], value):
                filled.append(key)
        _fill_labelled_links(page, profile)
    else:
        values = {
            "full_name": profile.get("name"), "email": profile.get("email"), "phone": profile.get("phone"),
            "company": profile.get("current_company"), "linkedin": profile.get("linkedin_url"),
            "github": profile.get("github_url"), "portfolio": profile.get("portfolio_url"),
            "comments": package.cover_note,
        }
        for key, value in values.items():
            if _fill(page, selectors[key], value):
                filled.append(key)
    if _upload(page, selectors["resume"], package.files.get("resume")):
        filled.append("resume")
    if "cover_letter" in selectors and _upload(page, selectors["cover_letter"], package.files.get("cover_letter")):
        filled.append("cover_letter")
    filled += [f"answer:{question}" for question in _fill_answer_bank(page, answers or [])]
    return filled


def _confirmed(page) -> bool:
    try:
        if "confirmation" in page.url.lower() or "thanks" in page.url.lower():
            return True
        return bool(CONFIRMATION_PATTERN.search(page.inner_text("body", timeout=2000)))
    except Exception:
        return False


def apply_in_page(page, package: Package, profile: dict, scope: str, confirm_timeout: float = 25.0,
                  answers: Optional[list] = None) -> Attempt:
    """Fill the open form; submit only for scope 'submit' with nothing left to a human."""
    platform = package.destination["platform"]
    # A login wall is the user's to pass, never the agent's.
    if page.evaluate(LOGIN_WALL_JS):
        return Attempt(package.job_id, platform, "login_required",
                       "the form asks you to sign in -- the agent never logs in for you", ["Sign in"])
    filled = fill_form(page, package, profile, answers)
    if "resume" not in filled:
        return Attempt(package.job_id, platform, "needs_you", "couldn't find the resume upload field",
                       ["Resume upload"])
    blockers = page.evaluate(UNFILLED_REQUIRED_JS)
    if page.evaluate(CAPTCHA_JS):
        blockers.append("CAPTCHA")
    if blockers:
        return Attempt(package.job_id, platform, "needs_you",
                       "required questions only you can answer", sorted(set(blockers)))
    if scope != "submit":
        return Attempt(package.job_id, platform, "filled", "form filled; waiting for you to press submit")

    button = _first(page, FIELD_SELECTORS[platform]["submit"])
    if button is None:
        return Attempt(package.job_id, platform, "needs_you", "couldn't find the submit button", ["Submit button"])
    button.click()
    deadline = time.monotonic() + confirm_timeout
    while time.monotonic() < deadline:
        if _confirmed(page):
            return Attempt(package.job_id, platform, "submitted", "employer's confirmation page shown")
        if page.evaluate(CAPTCHA_JS):
            return Attempt(package.job_id, platform, "needs_you", "a CAPTCHA appeared after submitting", ["CAPTCHA"])
        page.wait_for_timeout(500)
    late = page.evaluate(UNFILLED_REQUIRED_JS)
    return Attempt(package.job_id, platform, "unconfirmed",
                   "submitted but no confirmation was detected -- check the browser", late)

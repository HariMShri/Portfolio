"""Company careers pages and the applicant-tracking systems behind them.

Most company careers pages are a thin shell over a hosted applicant-tracking
system (ATS) -- Greenhouse, Lever, Ashby, SmartRecruiters or Workday -- and
each of those publishes the same listings as public JSON for candidates. So a
careers page is read in two steps:

1. ``resolve(url)`` works out which ATS and board the page uses, from the URL
   itself or from links in the page. Pages with no ATS are read from their
   schema.org ``JobPosting`` data, which careers sites publish for search
   engines. Pages behind a login are reported as such and never logged into.
2. ``fetch_site(site)`` reads that board's public listings.

Each call returns a status alongside the jobs (``ok``, ``empty``, ``dead``,
``error``, ``login_required``, ``blocked``, ``unsupported``) so the career
memory can learn which sites are worth visiting. robots.txt is honoured for
every careers page fetched as HTML; the ATS JSON endpoints are public APIs
meant for this.
"""
import json
import re
import urllib.robotparser
from typing import Optional
from urllib.parse import urljoin, urlparse

import requests

from ..models import Job

USER_AGENT = "Mozilla/5.0 (compatible; PersonalJobSearchAgent/1.0; single-candidate job search)"
HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/json, text/html;q=0.9"}
QA_TITLE = re.compile(r"\b(qa|test|tester|testing|quality|sdet|automation engineer)\b", re.I)
TIMEOUT = 20


def _strip_html(text: str) -> str:
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", text or "", flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    for entity, char in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&#39;", "'"), ("&quot;", '"')):
        text = text.replace(entity, char)
    return re.sub(r"\s+", " ", text).strip()


def _get(url: str, **kwargs):
    return requests.get(url, headers=HEADERS, timeout=TIMEOUT, **kwargs)


def _status_for(code: int) -> str:
    if code == 404 or code == 410:
        return "dead"
    if code in (401, 403):
        return "blocked"
    return "error"


# ---------- per-ATS readers: (jobs, status) ----------

def fetch_greenhouse(token: str) -> tuple[list[Job], str]:
    response = _get(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true")
    if response.status_code != 200:
        return [], _status_for(response.status_code)
    jobs = []
    for item in response.json().get("jobs", []):
        content = item.get("content", "")
        content = content.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&amp;", "&")
        jobs.append(Job(
            title=item.get("title", ""), company=token, location=(item.get("location") or {}).get("name", ""),
            url=item.get("absolute_url", ""), source="greenhouse", description=_strip_html(content),
            posted_date=item.get("updated_at"),
        ))
    return jobs, "ok" if jobs else "empty"


def fetch_lever(token: str) -> tuple[list[Job], str]:
    response = _get(f"https://api.lever.co/v0/postings/{token}?mode=json")
    if response.status_code != 200:
        return [], _status_for(response.status_code)
    jobs = []
    for item in response.json():
        categories = item.get("categories") or {}
        parts = [item.get("descriptionPlain", "")]
        for block in item.get("lists") or []:
            parts.append(block.get("text", ""))
            parts.append(_strip_html(block.get("content", "")))
        workplace = item.get("workplaceType", "")
        location = categories.get("location", "") or ""
        if workplace == "remote" and "remote" not in location.lower():
            location = f"Remote ({location})" if location else "Remote"
        jobs.append(Job(
            title=item.get("text", ""), company=token, location=location, url=item.get("hostedUrl", ""),
            source="lever", description=" ".join(p for p in parts if p),
        ))
    return jobs, "ok" if jobs else "empty"


def fetch_ashby(token: str) -> tuple[list[Job], str]:
    response = _get(f"https://api.ashbyhq.com/posting-api/job-board/{token}")
    if response.status_code != 200:
        return [], _status_for(response.status_code)
    jobs = []
    for item in response.json().get("jobs", []):
        location = item.get("location", "") or ""
        if item.get("isRemote") and "remote" not in location.lower():
            location = f"Remote ({location})" if location else "Remote"
        jobs.append(Job(
            title=item.get("title", ""), company=token, location=location,
            url=item.get("jobUrl", ""), source="ashby",
            description=item.get("descriptionPlain") or _strip_html(item.get("descriptionHtml", "")),
            posted_date=item.get("publishedAt"),
        ))
    return jobs, "ok" if jobs else "empty"


def fetch_smartrecruiters(company: str, max_details: int = 25) -> tuple[list[Job], str]:
    """Lists every posting, then fetches full text only for QA-looking titles."""
    postings, offset = [], 0
    while offset < 1000:
        response = _get(f"https://api.smartrecruiters.com/v1/companies/{company}/postings",
                        params={"limit": 100, "offset": offset})
        if response.status_code != 200:
            return [], _status_for(response.status_code)
        data = response.json()
        batch = data.get("content", [])
        postings.extend(batch)
        offset += 100
        if not batch or offset >= data.get("totalFound", 0):
            break
    jobs = []
    for item in [posting for posting in postings if QA_TITLE.search(posting.get("name", ""))][:max_details]:
        location = item.get("location") or {}
        place = ", ".join(part for part in (location.get("city"), location.get("country", "").upper()) if part)
        if location.get("remote"):
            place = f"Remote ({place})" if place else "Remote"
        description = ""
        try:
            detail = _get(item["ref"]) if item.get("ref") else None
            if detail is not None and detail.status_code == 200:
                sections = (detail.json().get("jobAd") or {}).get("sections") or {}
                description = " ".join(_strip_html((part or {}).get("text", "")) for part in sections.values())
        except (requests.RequestException, ValueError):
            pass
        jobs.append(Job(
            title=item.get("name", ""), company=(item.get("company") or {}).get("name", company), location=place,
            url=f"https://jobs.smartrecruiters.com/{company}/{item.get('id')}", source="smartrecruiters",
            description=description, posted_date=item.get("releasedDate"),
        ))
    return jobs, "ok" if postings else "empty"


WORKDAY_RE = re.compile(r"https?://([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?([A-Za-z0-9_-]+)")


def fetch_workday(site_url: str, search: str = "QA", max_details: int = 25) -> tuple[list[Job], str]:
    """Workday career sites load their listings from a public JSON endpoint
    (the same one the page itself calls). Applying on Workday needs a
    candidate account, so these jobs are always left to the user to apply."""
    match = WORKDAY_RE.match(site_url)
    if not match:
        return [], "unsupported"
    tenant, pod, site = match.groups()
    host = f"https://{tenant}.{pod}.myworkdayjobs.com"
    api = f"{host}/wday/cxs/{tenant}/{site}"
    postings, offset = [], 0
    while offset < 100:
        response = requests.post(f"{api}/jobs", headers={**HEADERS, "Content-Type": "application/json"},
                                 json={"appliedFacets": {}, "limit": 20, "offset": offset, "searchText": search},
                                 timeout=TIMEOUT)
        if response.status_code != 200:
            return [], _status_for(response.status_code)
        batch = response.json().get("jobPostings", [])
        postings.extend(batch)
        offset += 20
        if len(batch) < 20:
            break
    jobs = []
    for item in [posting for posting in postings if QA_TITLE.search(posting.get("title", ""))][:max_details]:
        path = item.get("externalPath", "")
        description = ""
        try:
            detail = _get(f"{api}{path}")
            if detail.status_code == 200:
                info = detail.json().get("jobPostingInfo") or {}
                description = _strip_html(info.get("jobDescription", ""))
        except (requests.RequestException, ValueError):
            pass
        jobs.append(Job(
            title=item.get("title", ""), company=tenant, location=item.get("locationsText", ""),
            url=f"{host}/{site}{path}", source="workday", description=description, posted_date=item.get("postedOn"),
        ))
    return jobs, "ok" if postings else "empty"


def fetch_jsonld(page_url: str) -> tuple[list[Job], str]:
    """schema.org JobPosting data embedded in a careers page."""
    html, status = _fetch_page(page_url)
    if html is None:
        return [], status
    jobs = _jsonld_jobs(html, page_url)
    return jobs, "ok" if jobs else "empty"


FETCHERS = {
    "greenhouse": fetch_greenhouse,
    "lever": fetch_lever,
    "ashby": fetch_ashby,
    "smartrecruiters": fetch_smartrecruiters,
    "workday": fetch_workday,
    "jsonld": fetch_jsonld,
}


def fetch_site(site: dict) -> tuple[list[Job], str]:
    fetcher = FETCHERS.get(site.get("platform"))
    if not fetcher:
        return [], "unsupported"
    try:
        return fetcher(site["token"])
    except (requests.RequestException, ValueError, KeyError):
        return [], "error"


# ---------- resolving a careers page ----------

ATS_PATTERNS = (
    ("greenhouse", re.compile(r"(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/(?:embed/job_board(?:/js)?\?for=)?([A-Za-z0-9_-]+)")),
    ("greenhouse", re.compile(r"boards-api\.greenhouse\.io/v1/boards/([A-Za-z0-9_-]+)")),
    ("lever", re.compile(r"jobs\.lever\.co/([A-Za-z0-9_-]+)")),
    ("ashby", re.compile(r"jobs\.ashbyhq\.com/([A-Za-z0-9_.-]+)")),
    ("smartrecruiters", re.compile(r"(?:careers|jobs)\.smartrecruiters\.com/([A-Za-z0-9_-]+)")),
)
IGNORED_TOKENS = {"embed", "js", "v1", "api", "jobs", "job_app", "oauth"}
# A password field on the careers page itself means the listings are behind a
# login. A "Sign in" link in the site navigation does not.
LOGIN_HINT = re.compile(r"<input[^>]+type=[\"']password", re.I)
JOBS_LINK = re.compile(r"href=[\"']([^\"'#]+)[\"'][^>]*>([^<]{0,80})", re.I)
JOBS_WORDS = re.compile(
    r"open (roles|positions)|openings|all jobs|view jobs|see jobs|job openings|search jobs|join us|careers?|jobs", re.I)


def _robots_allows(url: str) -> bool:
    parsed = urlparse(url)
    parser = urllib.robotparser.RobotFileParser()
    try:
        response = _get(f"{parsed.scheme}://{parsed.netloc}/robots.txt")
        if response.status_code >= 400:
            return True  # no robots.txt: nothing disallowed
        parser.parse(response.text.splitlines())
    except requests.RequestException:
        return True
    return parser.can_fetch(USER_AGENT, url)


def _fetch_page(url: str) -> tuple[Optional[str], str]:
    if not _robots_allows(url):
        return None, "blocked"
    try:
        response = _get(url)
    except requests.RequestException:
        return None, "error"
    if response.status_code != 200:
        return None, _status_for(response.status_code)
    return response.text, "ok"


def _jsonld_jobs(html: str, page_url: str) -> list[Job]:
    jobs = []
    for block in re.findall(r"<script[^>]+application/ld\+json[^>]*>(.*?)</script>", html, flags=re.S | re.I):
        try:
            data = json.loads(block.strip())
        except ValueError:
            continue
        items = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
        for item in items:
            if not isinstance(item, dict) or item.get("@type") != "JobPosting":
                continue
            place = item.get("jobLocation") or {}
            place = place[0] if isinstance(place, list) and place else place
            address = (place.get("address") or {}) if isinstance(place, dict) else {}
            location = ", ".join(str(v) for v in (address.get("addressLocality"), address.get("addressCountry")) if v)
            if item.get("jobLocationType") == "TELECOMMUTE":
                location = f"Remote ({location})" if location else "Remote"
            organisation = item.get("hiringOrganization") or {}
            jobs.append(Job(
                title=item.get("title", ""),
                company=organisation.get("name", "") if isinstance(organisation, dict) else str(organisation),
                location=location, url=urljoin(page_url, item.get("url") or page_url), source="careers",
                description=_strip_html(item.get("description", "")), posted_date=item.get("datePosted"),
            ))
    return jobs


def _from_html(html: str, url: str) -> Optional[dict]:
    workday = WORKDAY_RE.search(html)
    if workday:
        return {"platform": "workday", "token": workday.group(0), "status": "ok", "apply": "login_required"}
    for platform, pattern in ATS_PATTERNS:
        for token in pattern.findall(html):
            if token.lower() not in IGNORED_TOKENS:
                return {"platform": platform, "token": token, "status": "ok"}
    if _jsonld_jobs(html, url):
        return {"platform": "jsonld", "token": url, "status": "ok"}
    return None


def _job_list_links(html: str, url: str, limit: int = 4) -> list[str]:
    """Same-site links that look like the page listing open roles."""
    site = urlparse(url).netloc.split(".", 1)[-1]
    links = []
    for href, text in JOBS_LINK.findall(html):
        target = urljoin(url, href.strip())
        parsed = urlparse(target)
        same_site = parsed.netloc.endswith(site)
        looks_like_jobs = JOBS_WORDS.search(text) or JOBS_WORDS.search(parsed.path)
        if same_site and looks_like_jobs and target.rstrip("/") != url.rstrip("/") and target not in links:
            links.append(target)
        if len(links) >= limit:
            break
    return links


def _from_rendered(url: str, wait_ms: int = 6000) -> Optional[dict]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None
    requested = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(user_agent=USER_AGENT)
            page.on("request", lambda request: requested.append(request.url))
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(wait_ms)
            frames = " ".join(frame.url for frame in page.frames)
            html = page.content()
            browser.close()
    except Exception:
        return None
    return _from_html(" ".join(requested) + " " + frames + " " + html, url)


def resolve(url: str) -> dict:
    """{"platform", "token", "status"} for a careers page URL."""
    if WORKDAY_RE.match(url):
        return {"platform": "workday", "token": url, "status": "ok", "apply": "login_required"}
    for platform, pattern in ATS_PATTERNS:
        match = pattern.search(url)
        if match and match.group(1).lower() not in IGNORED_TOKENS:
            return {"platform": platform, "token": match.group(1), "status": "ok"}

    html, status = _fetch_page(url)
    if html is None:
        return {"platform": None, "token": None, "status": status}
    found = _from_html(html, url)
    if found:
        return found
    # Many careers pages are a landing page that links to the real job list.
    for link in _job_list_links(html, url):
        linked, _ = _fetch_page(link)
        found = _from_html(linked, link) if linked else None
        if found:
            return found
    # Pages that build their job list in JavaScript: load them in a headless
    # browser and look at what the page itself requests.
    found = _from_rendered(url)
    if found:
        return found
    if LOGIN_HINT.search(html):
        return {"platform": None, "token": None, "status": "login_required"}
    return {"platform": None, "token": None, "status": "unsupported"}

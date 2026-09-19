"""Indeed's search results page blocks plain HTTP requests (403 from a bot
check) but renders fine through a real browser. Uses Playwright headlessly
against the public, unauthenticated search page only -- no login, no account.

This is best-effort: Indeed can change its markup or tighten bot detection at
any time, in which case this should degrade to returning an empty list rather
than crash the whole pipeline.
"""
from ..models import Job

SEARCH_URL = "https://{domain}/jobs?q={query}&l={location}"


def fetch(query: str, location: str, domain: str = "in.indeed.com", max_results: int = 25, timeout_ms: int = 30000) -> list[Job]:
    try:
        from playwright.sync_api import sync_playwright
        from bs4 import BeautifulSoup
    except ImportError:
        print("  [indeed] playwright/bs4 not installed -- skipping. Run: pip install playwright beautifulsoup4 && playwright install chromium")
        return []

    url = SEARCH_URL.format(
        domain=domain,
        query=query.replace(" ", "+"),
        location=location.replace(" ", "+").replace(",", "%2C"),
    )

    jobs: list[Job] = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                           "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            page.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")
            page.wait_for_timeout(2500)
            html = page.content()
            browser.close()
    except Exception as e:
        print(f"  [indeed] fetch failed, skipping this source: {e}")
        return []

    soup = BeautifulSoup(html, "html.parser")
    cards = soup.select("div.job_seen_beacon")

    for card in cards[:max_results]:
        link = card.select_one("a[data-jk]")
        if not link:
            continue
        jk = link.get("data-jk", "")
        title_el = card.select_one(f"span#jobTitle-{jk}") or link
        company_el = card.select_one('[data-testid="company-name"]')
        location_el = card.select_one('[data-testid="text-location"]')
        snippet_el = card.select_one('[data-testid="belowJobSnippet"], .job-snippet')

        jobs.append(Job(
            title=title_el.get_text(strip=True) if title_el else "",
            company=company_el.get_text(strip=True) if company_el else "Unknown",
            location=location_el.get_text(strip=True) if location_el else "",
            url=f"https://{domain}/viewjob?jk={jk}",
            source="indeed",
            description=snippet_el.get_text(" ", strip=True) if snippet_el else "",
        ))

    return jobs

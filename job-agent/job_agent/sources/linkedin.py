"""LinkedIn's public "guest" job search page (linkedin.com/jobs/search, no
login) renders server-side HTML and doesn't require a browser. No account,
no cookies, no login -- but LinkedIn is known to rate-limit or block an IP
that hits this endpoint too often, so this deliberately makes one request
per run and fails quietly rather than retrying aggressively.
"""
import requests
from bs4 import BeautifulSoup
from ..models import Job

SEARCH_URL = "https://www.linkedin.com/jobs/search?keywords={query}&location={location}"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}


def fetch(query: str, location: str, max_results: int = 25, timeout: int = 20) -> list[Job]:
    url = SEARCH_URL.format(query=query.replace(" ", "%20"), location=location.replace(" ", "%20"))
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout)
        if resp.status_code != 200:
            print(f"  [linkedin] got HTTP {resp.status_code} -- skipping this source for this run")
            return []
    except requests.RequestException as e:
        print(f"  [linkedin] fetch failed, skipping this source: {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    cards = soup.select("li")

    jobs: list[Job] = []
    for card in cards:
        title_el = card.select_one("h3.base-search-card__title")
        if not title_el:
            continue
        company_el = card.select_one("h4.base-search-card__subtitle")
        location_el = card.select_one("span.job-search-card__location")
        link_el = card.select_one("a.base-card__full-link, a[href*='/jobs/view/']")

        jobs.append(Job(
            title=title_el.get_text(strip=True),
            company=company_el.get_text(strip=True) if company_el else "Unknown",
            location=location_el.get_text(strip=True) if location_el else "",
            url=link_el["href"].split("?")[0] if link_el and link_el.get("href") else "",
            source="linkedin",
            description="",  # full description requires visiting the job page individually
        ))
        if len(jobs) >= max_results:
            break

    return jobs

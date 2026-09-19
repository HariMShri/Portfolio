"""Naukri.com is a client-side rendered single-page app (the initial HTML is
an empty shell), AND it sits behind Akamai bot protection that returns a hard
"Access Denied" to headless/automated browsers -- confirmed by testing this
directly, not assumed. That block is a deliberate anti-bot measure, so this
module does not attempt to route around it (stealth plugins, proxies, etc.).

This returns an empty list by design. If Naukri exposes a documented public
API in the future, or you want to feed it job listings manually, use the
`sources.manual` module instead -- paste a job URL/description and it'll be
scored and drafted like anything else.
"""
from ..models import Job


def fetch(query: str, location: str, max_results: int = 25) -> list[Job]:
    print("  [naukri] skipped -- Naukri blocks automated access (Akamai bot protection, confirmed by testing). "
          "Use sources.manual to paste in specific Naukri listings you find yourself instead.")
    return []

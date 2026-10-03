"""Remote-work eligibility for a candidate based in India.

"Remote" on a listing usually means "remote within some country". A US-only
remote role is no more reachable than an onsite one in San Francisco, so the
Fit Analyst needs to tell these apart rather than treat every "Remote" as a
location match.
"""
import re

REMOTE_RE = re.compile(r"\b(remote|work from home|wfh|anywhere|distributed|telecommut\w*|home based)\b", re.I)
OPEN_RE = re.compile(r"\b(india|apac|asia|asia pacific|worldwide|global|anywhere|international)\b", re.I)
RESTRICTED_RE = re.compile(
    r"\b(us|usa|u\.s\.?|united states|canada|uk|u\.k\.|united kingdom|england|europe|european|eu|emea|"
    r"latam|latin america|americas|north america|south america|germany|france|spain|italy|poland|"
    r"netherlands|ireland|portugal|romania|ukraine|israel|australia|new zealand|brazil|mexico|argentina|"
    r"colombia|japan|singapore|philippines|south africa|nigeria|[a-z]{2,} time ?zones?|est|pst|cet)\b",
    re.I,
)

INDIA_RE = re.compile(
    r"\b(india|bangalore|bengaluru|chennai|hyderabad|pune|mumbai|delhi|new delhi|ncr|gurgaon|gurugram|noida|"
    r"kolkata|ahmedabad|kochi|cochin|trivandrum|thiruvananthapuram|coimbatore|mysore|mysuru|jaipur|indore|"
    r"chandigarh|bhubaneswar|vizag|visakhapatnam|nagpur|apac)\b|,\s*in$",
    re.I,
)

LABELS = {
    "remote_open": "Remote, open to candidates in India",
    "remote_unspecified": "Remote -- eligible countries not stated, confirm before applying",
    "remote_restricted": "Remote but limited to other countries",
    "abroad": "Onsite outside India",
}


def classify(location: str, title: str = "") -> str:
    """onsite | abroad | remote_open | remote_unspecified | remote_restricted."""
    location = (location or "").strip()
    if not REMOTE_RE.search(f"{location} {title}"):
        # An onsite role is only reachable if it's in India (or doesn't say).
        if location and not INDIA_RE.search(location):
            return "abroad"
        return "onsite"
    if OPEN_RE.search(location):
        return "remote_open"
    if RESTRICTED_RE.search(location):
        return "remote_restricted"
    return "remote_unspecified"

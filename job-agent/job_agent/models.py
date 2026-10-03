import hashlib
from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class GeminiRunState:
    rate_limited: bool = False


@dataclass
class Job:
    title: str
    company: str
    location: str
    url: str
    source: str
    description: str = ""
    posted_date: Optional[str] = None
    match_score: float = 0.0
    match_reasons: list = field(default_factory=list)
    draft_resume: Optional[dict] = None
    resume_review: Optional[dict] = None
    draft_cover_note: Optional[str] = None
    draft_qa: Optional[list] = None
    job_id: str = ""
    work_mode: str = ""  # onsite | remote_open | remote_unspecified | remote_restricted
    cover_review: Optional[dict] = None
    fit_gap: Optional[dict] = None
    is_new: bool = False
    site: str = ""  # career-memory key of the board this came from

    def __post_init__(self) -> None:
        # Stable across runs (derived from company+title, not row order or
        # timestamp) so a user can record an outcome today against a job
        # that was first shortlisted weeks ago. Not a secret -- it never
        # encodes profile or contact data, just this dedupe key.
        if not self.job_id:
            self.job_id = hashlib.sha256(self.dedupe_key().encode("utf-8")).hexdigest()[:12]

    def dedupe_key(self) -> str:
        return f"{self.company.strip().lower()}::{self.title.strip().lower()}"

    def to_dict(self) -> dict:
        return asdict(self)

from dataclasses import dataclass, field, asdict
from typing import Optional


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
    draft_cover_note: Optional[str] = None
    draft_qa: Optional[list] = None

    def dedupe_key(self) -> str:
        return f"{self.company.strip().lower()}::{self.title.strip().lower()}"

    def to_dict(self) -> dict:
        return asdict(self)

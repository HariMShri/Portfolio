"""Publish privacy-safe aggregate workflow status to the portfolio worker."""
import os

import requests


AGENT_IDS = (
    "role-scout",
    "fit-analyst",
    "resume-tailor",
    "application-writer",
    "application-reviewer",
    "application-coordinator",
    "feedback-analyst",
)
ACTIVE_PHASES = (
    "role-scout",
    "fit-analyst",
    "resume-tailor",
    "application-writer",
    "application-reviewer",
    "application-coordinator",
)


class StatusPublisher:
    """Best-effort publisher; telemetry failures never stop a search run."""

    def __init__(self) -> None:
        self.url = os.environ.get("STATUS_API_URL", "").strip()
        self.token = os.environ.get("STATUS_API_TOKEN", "").strip()

    def publish(
        self,
        phase: str,
        run_status: str,
        discovered: int = 0,
        shortlisted: int = 0,
        drafted: int = 0,
        resumes_tailored: int = 0,
        awaiting_review: int = 0,
        phase_complete: bool = False,
    ) -> None:
        if not self.url or not self.token:
            return

        phase_index = ACTIVE_PHASES.index(phase) if phase in ACTIVE_PHASES else -1
        agents = []
        for agent_id in AGENT_IDS:
            if agent_id in ACTIVE_PHASES:
                agent_index = ACTIVE_PHASES.index(agent_id)
                if agent_index < phase_index or run_status == "completed":
                    status = "completed"
                elif agent_index == phase_index:
                    status = "failed" if run_status == "failed" else (
                        "completed" if phase_complete else "running"
                    )
                else:
                    status = "idle"
            else:
                status = "planned"
            agents.append({"id": agent_id, "status": status})

        payload = {
            "schema_version": 1,
            "run_status": run_status,
            "counts": {
                "discovered": max(0, discovered),
                "shortlisted": max(0, shortlisted),
                "drafted": max(0, drafted),
                "resumes_tailored": max(0, resumes_tailored),
                "awaiting_review": max(0, awaiting_review),
                "applied": 0,
                "skipped": 0,
            },
            "agents": agents,
        }
        try:
            response = requests.post(
                self.url,
                json=payload,
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=5,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            print(f"  [status] publishing status failed: {exc.__class__.__name__}")
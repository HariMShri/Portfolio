import os as _os

_os.environ["DATABASE_URL"] = ""  # tests never touch the real shared database

import base64
import hashlib
import hmac
import json
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, unquote, urlparse

from job_agent import approvals, learning
from job_agent.models import Job
from job_agent.notifier import _approvals_html


def job_dict(**overrides):
    job = Job("QA Engineer", "acme", "Bangalore, India", "https://example.invalid/careers?gh_jid=4567", "greenhouse",
              description="SQL Postman")
    data = job.to_dict()
    data.update({
        "draft_resume": {"experience": [{"experience_index": 0, "highlight_indices": [0, 1]}], "skills": ["SQL"]},
        "draft_cover_note": "I test APIs.", "cover_review": {"passed": True, "issues": []},
    })
    data.update(overrides)
    return data


class FakeStore:
    def __init__(self):
        self.approvals, self.outcomes = {}, []

    def upsert_approval(self, record):
        old = self.approvals.get(record["job_id"])
        if old and old["approved_at"] >= record["approved_at"]:
            return False
        self.approvals[record["job_id"]] = record
        return True

    def latest_job(self, job_id):
        return {"company": "acme", "title": "QA Engineer"}

    def add_outcome(self, outcome):
        self.outcomes.append(outcome)


class ApprovalTests(unittest.TestCase):
    def test_token_is_hmac_signed_over_the_payload(self):
        token = approvals.sign_token({"j": "0123456789ab", "s": "submit"}, "k")
        body, signature = token.split(".")
        expected = base64.urlsafe_b64encode(
            hmac.new(b"k", f"approval-v1.{body}".encode(), hashlib.sha256).digest()).decode().rstrip("=")
        self.assertEqual(signature, expected)

    def test_content_hash_changes_with_anything_approved(self):
        base = approvals.content_hash(job_dict())
        self.assertEqual(base, approvals.content_hash(job_dict()))
        self.assertNotEqual(base, approvals.content_hash(job_dict(draft_cover_note="Different note.")))
        self.assertNotEqual(base, approvals.content_hash(job_dict(
            draft_resume={"experience": [{"experience_index": 0, "highlight_indices": [0]}], "skills": ["SQL"]})))
        self.assertNotEqual(base, approvals.content_hash(job_dict(url="https://example.invalid/careers?gh_jid=9999")))

    def test_failed_cover_note_is_never_part_of_an_approval(self):
        failed = job_dict(cover_review={"passed": False, "issues": ["x"]})
        self.assertEqual(approvals.approved_cover_note(failed), "")

    def test_links_cover_three_scopes_and_need_credentials(self):
        self.assertEqual(approvals.approval_links(job_dict(), "", "k"), {})
        links = approvals.approval_links(job_dict(), "https://w.example", "k", now=1_000_000)
        self.assertEqual(set(links), {"submit", "fill", "skip"})
        token = unquote(parse_qs(urlparse(links["fill"]).query)["t"][0])
        payload = json.loads(base64.urlsafe_b64decode(token.split(".")[0] + "=="))
        self.assertEqual((payload["s"], payload["e"]), ("fill", 1_000_000 + approvals.LINK_LIFETIME))

    def test_worker_base_from_status_url(self):
        self.assertEqual(approvals.worker_base("https://x.workers.dev/internal/status"), "https://x.workers.dev")
        self.assertEqual(approvals.worker_base(""), "")

    def test_sync_keeps_newest_click_and_turns_skips_into_outcomes(self):
        store = FakeStore()
        records = [
            {"job_id": "aaaaaaaaaaaa", "scope": "fill", "content_hash": "h", "approved_at": "2026-10-04T08:00:00Z", "expires_at": "x"},
            {"job_id": "bbbbbbbbbbbb", "scope": "skip", "content_hash": "h", "approved_at": "2026-10-04T08:00:00Z", "expires_at": "x"},
            {"job_id": "cccccccccccc", "scope": "delete-everything", "content_hash": "h", "approved_at": "z", "expires_at": "x"},
        ]
        with patch.object(approvals, "fetch_recorded", return_value=records):
            self.assertEqual(approvals.sync(store, "https://w", "k"), (1, 1))
            self.assertEqual(store.outcomes[0]["decision"], "skipped")
            self.assertEqual(approvals.sync(store, "https://w", "k"), (0, 0))  # already stored

    def test_email_buttons_are_escaped_and_only_for_jobs_with_links(self):
        job = Job("QA <b>Engineer</b>", "acme", "Bangalore", "https://x", "greenhouse")
        other = Job("Other", "acme", "Bangalore", "https://y", "greenhouse")
        html = _approvals_html([job, other], {job.job_id: {"submit": "https://w/a?t=1", "fill": "https://w/a?t=2",
                                                            "skip": "https://w/a?t=3"}})
        self.assertIn("Submit for me", html)
        self.assertIn("QA &lt;b&gt;Engineer&lt;/b&gt;", html)
        self.assertNotIn("Other", html)
        self.assertEqual(_approvals_html([other], {}), "")


class LearningTests(unittest.TestCase):
    def outcomes(self, source_results):
        outcomes, index = [], {}
        for i, (source, decision) in enumerate(source_results):
            job_id = f"{i:012d}"
            outcomes.append({"job_id": job_id, "decision": decision})
            index[job_id] = {"source": source}
        return outcomes, index

    def test_no_calibration_below_minimum_sample(self):
        outcomes, index = self.outcomes([("greenhouse", "interview")] * 3)
        self.assertEqual(learning.source_calibration(outcomes, index), {})

    def test_sources_that_get_interviews_gain_and_others_lose_bounded(self):
        outcomes, index = self.outcomes([("greenhouse", "interview")] * 5 + [("linkedin", "rejected")] * 5)
        calibration = learning.source_calibration(outcomes, index)
        self.assertEqual(calibration, {"greenhouse": 5, "linkedin": -5})

    def test_calibration_adjusts_score_with_a_reason(self):
        job = Job("QA", "a", "Bangalore", "u", "greenhouse")
        job.match_score = 50.0
        learning.apply_calibration(job, {"greenhouse": 3})
        self.assertEqual(job.match_score, 53.0)
        self.assertIn("Past outcomes from greenhouse: +3", job.match_reasons)

    def test_bullets_from_successful_resumes_get_boosted(self):
        outcomes = [{"job_id": f"j{i}", "decision": "interview"} for i in range(3)]
        plans = {f"j{i}": {"experience": [{"experience_index": 0, "highlight_indices": [2]}]} for i in range(3)}
        self.assertEqual(learning.highlight_boosts(outcomes, plans), {(0, 2): 2.0})
        self.assertEqual(learning.highlight_boosts(outcomes[:2], plans), {})

    def test_reusable_drafts_only_for_this_runs_jobs(self):
        job = Job("QA", "a", "Bangalore", "u", "greenhouse")
        drafts = {job.job_id: {"cover_note": "n", "qa": []}, "other": {"cover_note": "m", "qa": []}}
        self.assertEqual(list(learning.reusable_drafts(drafts, [job])), [job.job_id])

    def test_material_picking_skips_decided_and_prefers_undrafted(self):
        import main

        jobs = [Job(f"QA {i}", "acme", "Bangalore", f"https://example.invalid/c?gh_jid={i}", "greenhouse") for i in range(3)]
        for job, score in zip(jobs, (90, 80, 70)):
            job.match_score = score
        picked = main.pick_material_jobs(jobs, 2, True, decided=frozenset({jobs[0].job_id}),
                                         drafted=frozenset({jobs[1].job_id}))
        self.assertEqual([job.title for job in picked], ["QA 2", "QA 1"])


if __name__ == "__main__":
    unittest.main()

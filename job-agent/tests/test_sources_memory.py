import os as _os

_os.environ["DATABASE_URL"] = ""  # tests never touch the real shared database
import json
import unittest
from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from job_agent import career_memory
from job_agent.matcher import score_job
from job_agent.models import Job
from job_agent.remote import classify
from job_agent.report import render_resume_pdf
from job_agent.resume_tailor import fit_gap
from job_agent.reviewer import review_cover_note
from job_agent.sources import careers

PROFILE = json.loads(Path(__file__).resolve().parents[1].joinpath("profile.json").read_text(encoding="utf-8"))


def job(title="QA Engineer", location="Bangalore, India", description="SQL Postman manual testing"):
    return Job(title, "Acme", location, "https://example.invalid", "manual", description=description)


class RemoteTests(unittest.TestCase):
    def test_classification(self):
        self.assertEqual(classify("Bangalore, India"), "onsite")
        self.assertEqual(classify("Remote - India"), "remote_open")
        self.assertEqual(classify("Remote (Worldwide)"), "remote_open")
        self.assertEqual(classify("Remote"), "remote_unspecified")
        self.assertEqual(classify("Remote - US"), "remote_restricted")
        self.assertEqual(classify("Remote (Europe, USA, UK)"), "remote_restricted")
        self.assertEqual(classify("Prague, Czech Republic"), "abroad")
        self.assertEqual(classify("Chennai, IN"), "onsite")
        self.assertEqual(classify("Hybrid in Bangalore, India"), "onsite")
        self.assertEqual(classify(""), "onsite")

    def test_us_only_remote_is_excluded_not_rewarded(self):
        scored = score_job(job(location="Remote - US"), PROFILE)
        self.assertEqual(scored.match_score, 0.0)
        self.assertEqual(scored.work_mode, "remote_restricted")

    def test_india_remote_scores_like_a_target_city(self):
        remote = score_job(job(location="Remote - India"), PROFILE).match_score
        onsite = score_job(job(location="Bangalore, India"), PROFILE).match_score
        self.assertEqual(remote, onsite)


class MatcherTests(unittest.TestCase):
    def test_skills_match_whole_terms_only(self):
        scored = score_job(job(description="NoSQL document stores"), PROFILE)
        self.assertFalse(any("profile skills found" in reason for reason in scored.match_reasons))

    def test_demand_weights_skills_once_memory_has_data(self):
        plain = score_job(job(description="SQL and JIRA"), PROFILE).match_score
        weighted = score_job(job(description="SQL and JIRA"), PROFILE, {"sql": 100, "jira": 100}).match_score
        self.assertGreater(weighted, plain)


class CareerMemoryTests(unittest.TestCase):
    def test_dead_board_is_parked_after_two_failures_then_retried(self):
        memory = career_memory.empty_memory()
        now = career_memory._now()
        career_memory.record_visit(memory, "greenhouse:gone", "dead", 0, now)
        self.assertIsNone(career_memory.parked(memory, "greenhouse:gone", now))
        career_memory.record_visit(memory, "greenhouse:gone", "dead", 0, now)
        self.assertIsNotNone(career_memory.parked(memory, "greenhouse:gone", now))
        self.assertIsNone(career_memory.parked(memory, "greenhouse:gone", now + timedelta(days=8)))

    def test_login_pages_are_parked_immediately(self):
        memory = career_memory.empty_memory()
        career_memory.record_visit(memory, "careers:x", "login_required", 0)
        self.assertIn("login_required", career_memory.parked(memory, "careers:x"))

    def test_new_jobs_are_marked_once(self):
        memory = career_memory.empty_memory()
        self.assertEqual(career_memory.mark_new(memory, [job()], career_memory._now() - timedelta(days=1)), 1)
        again = [job()]
        self.assertEqual(career_memory.mark_new(memory, again), 0)
        self.assertFalse(again[0].is_new)

    def test_memory_round_trips_and_stores_no_listing_text(self):
        with TemporaryDirectory() as out:
            memory = career_memory.load(out)
            career_memory.record_visit(memory, "greenhouse:acme", "ok", 3)
            career_memory.mark_new(memory, [job(description="secret listing text")])
            career_memory.save(out, memory)
            text = Path(out, career_memory.MEMORY_FILENAME).read_text(encoding="utf-8")
            self.assertNotIn("secret listing text", text)
            self.assertNotIn("QA Engineer", text)
            self.assertEqual(career_memory.load(out)["sites"]["greenhouse:acme"]["jobs_total"], 3)

    def test_apply_route_learns_login_only_platforms(self):
        memory = career_memory.empty_memory()
        career_memory.learn_apply_route(memory, "workday", "login_required")
        self.assertEqual(career_memory.apply_route(memory, "workday"), "login_required")


class FakeResponse:
    def __init__(self, status_code=200, text="", payload=None):
        self.status_code, self.text, self._payload = status_code, text, payload

    def json(self):
        return self._payload


class CareersTests(unittest.TestCase):
    def test_resolve_from_url_needs_no_fetch(self):
        self.assertEqual(careers.resolve("https://jobs.lever.co/acme")["platform"], "lever")
        self.assertEqual(careers.resolve("https://acme.wd3.myworkdayjobs.com/External")["platform"], "workday")

    def test_resolve_finds_ats_link_in_page(self):
        html = '<a href="https://job-boards.greenhouse.io/acmeinc/jobs/123">Open roles</a>'
        with patch.object(careers, "_fetch_page", return_value=(html, "ok")):
            self.assertEqual(careers.resolve("https://acme.example/careers"),
                             {"platform": "greenhouse", "token": "acmeinc", "status": "ok"})

    def test_login_wall_is_reported_never_entered(self):
        html = '<form><input type="password" name="pw"></form>'
        with patch.object(careers, "_fetch_page", return_value=(html, "ok")), \
                patch.object(careers, "_from_rendered", return_value=None):
            self.assertEqual(careers.resolve("https://acme.example/careers")["status"], "login_required")

    def test_jsonld_job_postings(self):
        posting = {
            "@type": "JobPosting", "title": "QA Engineer", "description": "<p>Test APIs</p>",
            "hiringOrganization": {"name": "Acme"}, "jobLocationType": "TELECOMMUTE",
            "jobLocation": {"address": {"addressLocality": "Pune", "addressCountry": "India"}}, "url": "/jobs/1",
        }
        html = '<script type="application/ld+json">' + json.dumps(posting) + "</script>"
        jobs = careers._jsonld_jobs(html, "https://acme.example/careers")
        self.assertEqual((jobs[0].title, jobs[0].location, jobs[0].url),
                         ("QA Engineer", "Remote (Pune, India)", "https://acme.example/jobs/1"))

    def test_dead_board_reports_dead(self):
        with patch.object(careers.requests, "get", return_value=FakeResponse(404)):
            self.assertEqual(careers.fetch_greenhouse("gone"), ([], "dead"))

    def test_robots_disallow_is_honoured(self):
        robots = FakeResponse(200, "User-agent: *\nDisallow: /careers")
        with patch.object(careers, "_get", return_value=robots):
            self.assertFalse(careers._robots_allows("https://acme.example/careers"))


class ReviewerAndTailorTests(unittest.TestCase):
    def test_cover_note_fact_check(self):
        listing = job(description="Kubernetes and Postman")
        listing.draft_cover_note = "I have 8 years of Cypress experience."
        review = review_cover_note(listing, PROFILE)
        self.assertFalse(review["passed"])
        self.assertTrue(any("8" in issue for issue in review["issues"]))
        listing.draft_cover_note = "I am eager to learn Kubernetes and bring Postman API testing."
        self.assertTrue(review_cover_note(listing, PROFILE)["passed"])

    def test_fit_gap_never_claims_missing_skills(self):
        gap = fit_gap(job(description="Cypress and SQL and Postman"), PROFILE)
        self.assertIn("cypress", gap["missing"])
        self.assertIn("sql", gap["covered"])

    def test_resume_is_trimmed_to_one_page(self):
        long_profile = dict(PROFILE)
        long_profile["experience"] = [dict(PROFILE["experience"][0],
                                           highlights=[f"Verified highlight number {i} " * 6 for i in range(40)])]
        listing = job()
        listing.draft_resume = {"experience": [{"experience_index": 0, "highlight_indices": list(range(40))}],
                                "skills": PROFILE["skills"][:5]}
        with TemporaryDirectory() as out:
            self.assertEqual(render_resume_pdf(listing, long_profile, str(Path(out, "r.pdf"))), 1)
        # The job's own selection is untouched; only the rendered copy is trimmed.
        self.assertEqual(len(listing.draft_resume["experience"][0]["highlight_indices"]), 40)


if __name__ == "__main__":
    unittest.main()

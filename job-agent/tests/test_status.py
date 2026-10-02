import os
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

import requests

from job_agent.status import AGENT_IDS, StatusPublisher
from job_agent.resume_tailor import tailor_resume_for_job, tailor_shortlist, validate_resume_plan
from job_agent.models import Job
from job_agent.report import render_resume_html, write_report
from job_agent.drafter import draft_for_job, draft_shortlist


def ollama_response(text, done=True):
    """An /api/generate payload shaped like the real one."""
    return {"model": "test-model", "response": text, "done": done}


class StatusPublisherTests(unittest.TestCase):
    def test_publishes_only_aggregate_contract(self):
        with patch.dict(os.environ, {
            "STATUS_API_URL": "https://example.invalid/internal/status",
            "STATUS_API_TOKEN": "test-token",
        }), patch("job_agent.status.requests.post") as post:
            StatusPublisher().publish(
                "application-writer", "running", discovered=8,
                shortlisted=3, drafted=2, awaiting_review=2,
                phase_complete=True,
            )

        post.assert_called_once()
        args, kwargs = post.call_args
        self.assertEqual(args[0], "https://example.invalid/internal/status")
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer test-token")
        payload = kwargs["json"]
        self.assertEqual(payload["counts"]["discovered"], 8)
        self.assertEqual(payload["counts"]["applied"], 0)
        self.assertEqual(payload["counts"]["resumes_tailored"], 0)
        self.assertEqual([agent["id"] for agent in payload["agents"]], list(AGENT_IDS))
        self.assertEqual(payload["agents"][3]["status"], "completed")
        self.assertNotIn("job", str(payload).lower())
        self.assertNotIn("profile", payload)


class ResumePlanValidationTests(unittest.TestCase):
    def setUp(self):
        self.profile = {
            "skills": ["Python", "SQL"],
            "experience": [{"highlights": ["Validated APIs", "Wrote tests"]}],
        }

    def test_accepts_only_indexed_profile_evidence(self):
        plan, issues = validate_resume_plan({
            "experience": [{"experience_index": 0, "highlight_indices": [1, 0]}],
            "skills": ["SQL", "Python"],
        }, self.profile)

        self.assertEqual(issues, [])
        self.assertEqual(plan["experience"][0]["highlight_indices"], [1, 0])

    def test_rejects_out_of_range_evidence_and_unverified_skills(self):
        plan, issues = validate_resume_plan({
            "experience": [{"experience_index": 4, "highlight_indices": [0]}],
            "skills": ["Invented framework"],
        }, self.profile)

        self.assertIsNone(plan)
        self.assertTrue(any("outside" in issue for issue in issues))
        self.assertTrue(any("not present" in issue for issue in issues))

    def test_resume_render_uses_only_selected_source_highlights(self):
        job = Job("QA Engineer", "Example Co", "Remote", "https://example.invalid", "manual")
        job.draft_resume = {
            "experience": [{"experience_index": 0, "highlight_indices": [1]}],
            "skills": ["SQL"],
        }
        job.resume_review = {"passed": True, "issues": []}

        output = render_resume_html(job, {
            "name": "Private Name Sentinel",
            "email": "candidate@example.invalid",
            "experience": [{
                "company": "Example Employer",
                "title": "Test Engineer",
                "dates": "2020-2024",
                "location": "Remote",
                "highlights": ["Unselected fact", "Verified source fact"],
            }],
            "skills": ["SQL"],
            "summary": "Verified summary.",
            "education": [],
            "certifications": [],
        })

        self.assertIn("Verified source fact", output)
        self.assertNotIn("Unselected fact", output)
        self.assertIn("source PDF is unchanged", output)

    def test_resume_tailoring_makes_no_network_call_at_all(self):
        """Evidence selection is local, so nothing about the candidate can
        leave the process during tailoring."""
        profile = {
            **self.profile,
            "name": "Private Name Sentinel",
            "email": "candidate@example.invalid",
        }
        job = Job("QA Engineer", "Example Co", "Remote", "https://example.invalid", "manual",
                  description="Looking for Python and SQL test automation.")

        with patch("requests.post") as post, patch("requests.get") as get:
            tailor_resume_for_job(job, profile)

        post.assert_not_called()
        get.assert_not_called()
        self.assertTrue(job.resume_review["passed"])
        self.assertIn("Python", job.draft_resume["skills"])

    def test_application_writer_sends_only_professional_profile_facts(self):
        profile = {
            **self.profile,
            "name": "Private Name Sentinel",
            "email": "private@example.invalid",
            "phone": "+10000000000",
            "location": "Private Location",
            "portfolio_url": "https://portfolio.example.invalid",
        }
        response = Mock()
        response.json.return_value = ollama_response(json.dumps({
            "cover_note": "A truthful cover note.",
            "qa": [],
        }))
        job = Job("QA Engineer", "Example Co", "Remote", "https://example.invalid", "manual")

        with patch("job_agent.local_llm.requests.post", return_value=response) as post:
            draft_for_job(job, profile, "test-model")

        prompt = post.call_args.kwargs["json"]["prompt"]
        self.assertIn("Validated APIs", prompt)
        self.assertNotIn(profile["name"], prompt)
        self.assertNotIn(profile["email"], prompt)
        self.assertNotIn(profile["phone"], prompt)
        self.assertNotIn(profile["location"], prompt)
        self.assertNotIn(profile["portfolio_url"], prompt)

    def test_local_model_http_failure_logs_status_without_response_body(self):
        profile = {**self.profile, "summary": "Verified summary."}
        response = Mock()
        response.raise_for_status.side_effect = requests.HTTPError(
            "model failure", response=Mock(status_code=500, text="private server body")
        )
        job = Job("QA Engineer", "Example Co", "Remote", "https://example.invalid", "manual")

        with patch("job_agent.local_llm.requests.post", return_value=response), patch("builtins.print") as print_mock:
            draft_for_job(job, profile, "test-model")

        logged_text = " ".join(str(call.args[0]) for call in print_mock.call_args_list)
        self.assertIn("HTTP 500", logged_text)
        self.assertNotIn("private server body", logged_text)
        self.assertIn("[Drafting failed", job.draft_cover_note)

    def test_report_writer_creates_a_linked_standalone_resume(self):
        profile = {
            "name": "Candidate",
            "email": "candidate@example.invalid",
            "phone": "+10000000000",
            "location": "Remote",
            "summary": "Verified summary.",
            "skills": ["SQL"],
            "experience": [{
                "company": "Example Employer",
                "title": "Test Engineer",
                "dates": "2020-2024",
                "location": "Remote",
                "highlights": ["Verified source fact"],
            }],
            "education": [],
            "certifications": [],
        }
        job = Job("QA Engineer", "Example Co", "Remote", "https://example.invalid", "manual")
        job.draft_resume = {
            "experience": [{"experience_index": 0, "highlight_indices": [0]}],
            "skills": ["SQL"],
        }
        job.resume_review = {"passed": True, "issues": []}

        with TemporaryDirectory() as output_dir:
            html_path, pdf_path, json_path = write_report([job], profile, output_dir)
            resume_files = list(Path(output_dir).glob("resume_*.html"))
            report_html = Path(html_path).read_text(encoding="utf-8")
            self.assertTrue(Path(pdf_path).exists())
            self.assertTrue(Path(json_path).exists())
            self.assertEqual(len(resume_files), 1)
            self.assertTrue(resume_files[0].exists())

        self.assertIn(resume_files[0].name, report_html)

    def test_missing_credentials_disables_publishing(self):
        with patch.dict(os.environ, {}, clear=True), patch("job_agent.status.requests.post") as post:
            StatusPublisher().publish("role-scout", "running")

        post.assert_not_called()

    def test_network_error_does_not_interrupt_job_run(self):
        with patch.dict(os.environ, {
            "STATUS_API_URL": "https://example.invalid/internal/status",
            "STATUS_API_TOKEN": "test-token",
        }), patch("job_agent.status.requests.post", side_effect=requests.Timeout), patch("builtins.print"):
            StatusPublisher().publish("role-scout", "running")

    def test_failure_marks_the_active_agent_failed(self):
        with patch.dict(os.environ, {
            "STATUS_API_URL": "https://example.invalid/internal/status",
            "STATUS_API_TOKEN": "test-token",
        }), patch("job_agent.status.requests.post") as post:
            StatusPublisher().publish("application-coordinator", "failed")

        coordinator = next(
            agent for agent in post.call_args.kwargs["json"]["agents"]
            if agent["id"] == "application-coordinator"
        )
        self.assertEqual(coordinator["status"], "failed")

    def test_zero_generated_materials_mark_completed_stages_needing_attention(self):
        with patch.dict(os.environ, {
            "STATUS_API_URL": "https://example.invalid/internal/status",
            "STATUS_API_TOKEN": "test-token",
        }), patch("job_agent.status.requests.post") as post:
            StatusPublisher().publish(
                "application-coordinator", "completed", discovered=100,
                shortlisted=5, drafted=0, resumes_tailored=0,
                awaiting_review=0, phase_complete=True,
            )

        agents = {agent["id"]: agent["status"] for agent in post.call_args.kwargs["json"]["agents"]}
        self.assertEqual(agents["role-scout"], "completed")
        self.assertEqual(agents["fit-analyst"], "completed")
        self.assertEqual(agents["resume-tailor"], "failed")
        self.assertEqual(agents["application-writer"], "failed")
        self.assertEqual(agents["application-reviewer"], "failed")
        self.assertEqual(agents["application-coordinator"], "completed")


if __name__ == "__main__":
    unittest.main()
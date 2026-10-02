import os
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

import requests

from job_agent.status import AGENT_IDS, StatusPublisher
from job_agent.resume_tailor import tailor_resume_for_job, tailor_shortlist, validate_resume_plan
from job_agent.models import GeminiRunState, Job
from job_agent.report import render_resume_html, write_report
from job_agent.drafter import draft_for_job, draft_shortlist
from job_agent import gemini_client
from job_agent.gemini_client import _extract_text, gemini_json_request


def interaction(text, status="completed"):
    """An Interactions API payload shaped like the real one."""
    return {
        "id": "v1_test",
        "model": "test-model",
        "status": status,
        "steps": [{"type": "model_output", "content": [{"type": "text", "text": text}]}],
    }


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
        gemini_client._last_call_at = 0.0
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

    def test_resume_tailoring_sends_no_contact_fields_to_model(self):
        profile = {
            **self.profile,
            "name": "Private Name Sentinel",
            "email": "candidate@example.invalid",
            "phone": "+10000000000",
            "location": "Remote",
        }
        response = Mock()
        response.json.return_value = interaction(json.dumps({
            "experience": [{"experience_index": 0, "highlight_indices": [0]}],
            "skills": ["Python"],
        }))
        job = Job("QA Engineer", "Example Co", "Remote", "https://example.invalid", "manual")

        with patch("job_agent.gemini_client.requests.post", return_value=response) as post:
            tailor_resume_for_job(job, profile, "test-key", "test-model")

        self.assertTrue(job.resume_review["passed"])
        self.assertEqual(job.draft_resume["skills"], ["Python"])
        prompt = post.call_args.kwargs["json"]["input"]
        self.assertNotIn(profile["email"], prompt)
        self.assertNotIn(profile["phone"], prompt)
        self.assertNotIn(profile["name"], prompt)

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
        response.json.return_value = interaction(json.dumps({
            "cover_note": "A truthful cover note.",
            "qa": [],
        }))
        job = Job("QA Engineer", "Example Co", "Remote", "https://example.invalid", "manual")

        with patch("job_agent.gemini_client.requests.post", return_value=response) as post:
            draft_for_job(job, profile, "test-key", "test-model")

        prompt = post.call_args.kwargs["json"]["input"]
        self.assertIn("Validated APIs", prompt)
        self.assertNotIn(profile["name"], prompt)
        self.assertNotIn(profile["email"], prompt)
        self.assertNotIn(profile["phone"], prompt)
        self.assertNotIn(profile["location"], prompt)
        self.assertNotIn(profile["portfolio_url"], prompt)

    def test_gemini_http_failure_logs_status_without_response_body(self):
        profile = {**self.profile, "summary": "Verified summary."}
        response = Mock()
        response.raise_for_status.side_effect = requests.HTTPError(
            "provider failure", response=Mock(status_code=403, text="private provider body")
        )
        job = Job("QA Engineer", "Example Co", "Remote", "https://example.invalid", "manual")

        with patch("job_agent.gemini_client.requests.post", return_value=response), patch("builtins.print") as print_mock:
            draft_for_job(job, profile, "test-secret", "test-model")

        logged_text = " ".join(str(call.args[0]) for call in print_mock.call_args_list)
        self.assertIn("HTTP 403", logged_text)
        self.assertNotIn("private provider body", logged_text)
        self.assertNotIn("test-secret", logged_text)

    def test_resume_tailor_http_failure_logs_status_without_response_body(self):
        response = Mock()
        response.raise_for_status.side_effect = requests.HTTPError(
            "provider failure", response=Mock(status_code=429, text="private provider body")
        )
        job = Job("QA Engineer", "Example Co", "Remote", "https://example.invalid", "manual")

        with patch("job_agent.gemini_client.requests.post", return_value=response), patch("builtins.print") as print_mock:
            tailor_resume_for_job(job, self.profile, "test-secret", "test-model")

        logged_text = " ".join(str(call.args[0]) for call in print_mock.call_args_list)
        self.assertIn("HTTP 429", logged_text)
        self.assertNotIn("private provider body", logged_text)
        self.assertNotIn("test-secret", logged_text)
        self.assertFalse(job.resume_review["passed"])

    def test_resume_tailor_stops_after_quota_rate_limit(self):
        response = Mock()
        response.raise_for_status.side_effect = requests.HTTPError(
            "quota", response=Mock(status_code=429)
        )
        jobs = [
            Job("QA Engineer", f"Example {index}", "Remote", "https://example.invalid", "manual")
            for index in range(3)
        ]
        run_state = GeminiRunState()

        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}), \
                patch("job_agent.gemini_client.requests.post", return_value=response) as post, \
                patch("builtins.print"):
            tailor_shortlist(jobs, self.profile, "test-model", run_state)

        self.assertTrue(run_state.rate_limited)
        self.assertEqual(post.call_count, 1)

    def test_application_writer_stops_after_quota_rate_limit(self):
        response = Mock()
        response.raise_for_status.side_effect = requests.HTTPError(
            "quota", response=Mock(status_code=429)
        )
        jobs = [
            Job("QA Engineer", f"Example {index}", "Remote", "https://example.invalid", "manual")
            for index in range(3)
        ]
        run_state = GeminiRunState()

        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}), \
                patch("job_agent.gemini_client.requests.post", return_value=response) as post, \
                patch("builtins.print"):
            draft_shortlist(jobs, self.profile, "test-model", run_state)

        self.assertTrue(run_state.rate_limited)
        self.assertEqual(post.call_count, 1)

    def test_invalid_gemini_json_has_clear_safe_diagnostic(self):
        response = Mock()
        response.json.return_value = interaction("not a JSON document")
        job = Job("QA Engineer", "Example Co", "Remote", "https://example.invalid", "manual")

        with patch("job_agent.gemini_client.requests.post", return_value=response), \
                patch("job_agent.gemini_client.time.sleep"), patch("builtins.print") as print_mock:
            tailor_resume_for_job(job, self.profile, "test-secret", "test-model")

        logged_text = " ".join(str(call.args[0]) for call in print_mock.call_args_list)
        self.assertIn("not valid JSON", logged_text)
        self.assertNotIn("test-secret", logged_text)

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


class GeminiClientRetryTests(unittest.TestCase):
    """The CI runs of 2026-10-02 lost every draft: first to unretried 503s
    and a 429 that killed the run, then -- once retries existed -- to the
    client reading `output_text`, which the REST API never returns. These
    pin down both the retry policy and the real response contract."""

    def setUp(self):
        gemini_client._last_call_at = 0.0

    def test_transient_server_error_retries_then_succeeds(self):
        failure = Mock()
        failure.raise_for_status.side_effect = requests.HTTPError(
            "unavailable", response=Mock(status_code=503)
        )
        success = Mock()
        success.json.return_value = interaction(json.dumps({"ok": True}))

        with patch("job_agent.gemini_client.requests.post", side_effect=[failure, success]) as post, \
                patch("job_agent.gemini_client.time.sleep") as sleep_mock, \
                patch("builtins.print"):
            parsed, error = gemini_json_request("prompt", "system", "key", "model", None, "test")

        self.assertIsNone(error)
        self.assertEqual(parsed, {"ok": True})
        self.assertEqual(post.call_count, 2)
        # One backoff sleep before the retry, plus the inter-call pacing gap.
        delays = [call.args[0] for call in sleep_mock.call_args_list]
        self.assertTrue(any(delay >= gemini_client.BASE_BACKOFF_SECONDS for delay in delays), delays)

    def test_transient_server_error_gives_up_after_bounded_retries(self):
        failure = Mock()
        failure.raise_for_status.side_effect = requests.HTTPError(
            "unavailable", response=Mock(status_code=503)
        )

        with patch("job_agent.gemini_client.requests.post", return_value=failure) as post, \
                patch("job_agent.gemini_client.time.sleep"), \
                patch("builtins.print"):
            parsed, error = gemini_json_request("prompt", "system", "key", "model", None, "test")

        self.assertIsNone(parsed)
        self.assertIn("HTTP 503", error)
        # 1 initial attempt + MAX_TRANSIENT_RETRIES retries, never unbounded.
        self.assertEqual(post.call_count, 3)

    def test_malformed_json_retries_once_then_succeeds(self):
        bad = Mock()
        bad.json.return_value = interaction("not json")
        good = Mock()
        good.json.return_value = interaction(json.dumps({"ok": True}))

        with patch("job_agent.gemini_client.requests.post", side_effect=[bad, good]) as post, \
                patch("job_agent.gemini_client.time.sleep"), patch("builtins.print"):
            parsed, error = gemini_json_request("prompt", "system", "key", "model", None, "test")

        self.assertIsNone(error)
        self.assertEqual(parsed, {"ok": True})
        self.assertEqual(post.call_count, 2)

    def test_rate_limit_pauses_run_without_burning_every_remaining_call(self):
        limited = Mock()
        limited.raise_for_status.side_effect = requests.HTTPError(
            "quota", response=Mock(status_code=429)
        )
        run_state = GeminiRunState()

        with patch("job_agent.gemini_client.requests.post", return_value=limited) as post, \
                patch("builtins.print"):
            parsed, error = gemini_json_request("prompt", "system", "key", "model", run_state, "test")

        self.assertIsNone(parsed)
        self.assertTrue(run_state.rate_limited)
        self.assertEqual(post.call_count, 1)


class InteractionsResponseContractTests(unittest.TestCase):
    """`output_text` is an SDK convenience property, absent from the REST
    payload. Reading it meant every draft parsed as empty text."""

    def setUp(self):
        gemini_client._last_call_at = 0.0

    def test_extracts_text_from_steps(self):
        self.assertEqual(_extract_text(interaction('{"ok": true}')), '{"ok": true}')

    def test_prefers_last_model_output_step(self):
        payload = {
            "status": "completed",
            "steps": [
                {"type": "reasoning", "content": [{"type": "text", "text": "thinking"}]},
                {"type": "model_output", "content": [{"type": "text", "text": "answer"}]},
            ],
        }
        self.assertEqual(_extract_text(payload), "answer")

    def test_joins_split_text_blocks(self):
        payload = {"steps": [{"type": "model_output", "content": [
            {"type": "text", "text": '{"a":'}, {"type": "text", "text": "1}"},
        ]}]}
        self.assertEqual(_extract_text(payload), '{"a":1}')

    def test_still_accepts_sdk_shaped_output_text(self):
        self.assertEqual(_extract_text({"output_text": '{"ok": true}'}), '{"ok": true}')

    def test_missing_text_returns_empty_rather_than_raising(self):
        self.assertEqual(_extract_text({"status": "failed", "steps": []}), "")
        self.assertEqual(_extract_text(None), "")

    def test_real_response_shape_parses_end_to_end(self):
        response = Mock()
        response.json.return_value = interaction(json.dumps({"cover_note": "hi", "qa": []}))

        with patch("job_agent.gemini_client.requests.post", return_value=response), patch("builtins.print"):
            parsed, error = gemini_json_request("p", "s", "key", "model", None, "test")

        self.assertIsNone(error)
        self.assertEqual(parsed["cover_note"], "hi")

    def test_empty_output_fails_fast_without_burning_another_call(self):
        response = Mock()
        response.json.return_value = {"status": "failed", "steps": []}

        with patch("job_agent.gemini_client.requests.post", return_value=response) as post, \
                patch("builtins.print") as print_mock:
            parsed, error = gemini_json_request("p", "s", "key", "model", None, "test")

        self.assertIsNone(parsed)
        self.assertIn("no output text", error)
        self.assertEqual(post.call_count, 1)
        logged = " ".join(str(c.args[0]) for c in print_mock.call_args_list)
        self.assertIn("status=failed", logged)

    def test_schema_is_sent_as_response_format(self):
        response = Mock()
        response.json.return_value = interaction("{}")
        schema = {"type": "object", "properties": {"a": {"type": "string"}}}

        with patch("job_agent.gemini_client.requests.post", return_value=response) as post, patch("builtins.print"):
            gemini_json_request("p", "s", "key", "model", None, "test", schema)

        body = post.call_args.kwargs["json"]
        self.assertEqual(body["response_format"]["mime_type"], "application/json")
        self.assertEqual(body["response_format"]["schema"], schema)

    def test_rejected_schema_falls_back_to_a_plain_request(self):
        """The structured-output field is the one part of the body that may
        not be accepted; a rejection must not cost the job its draft."""
        rejected = Mock()
        rejected.raise_for_status.side_effect = requests.HTTPError(
            "bad request", response=Mock(status_code=400)
        )
        accepted = Mock()
        accepted.json.return_value = interaction('{"ok": true}')
        schema = {"type": "object"}

        with patch("job_agent.gemini_client.requests.post", side_effect=[rejected, accepted]) as post, \
                patch("job_agent.gemini_client.time.sleep"), patch("builtins.print") as print_mock:
            parsed, error = gemini_json_request("p", "s", "key", "model", None, "test", schema)

        self.assertIsNone(error)
        self.assertEqual(parsed, {"ok": True})
        self.assertEqual(post.call_count, 2)
        self.assertIn("response_format", post.call_args_list[0].kwargs["json"])
        self.assertNotIn("response_format", post.call_args_list[1].kwargs["json"])
        logged = " ".join(str(c.args[0]) for c in print_mock.call_args_list)
        self.assertIn("retrying without it", logged)

    def test_diagnostics_never_leak_response_content_or_key(self):
        response = Mock()
        response.json.return_value = {
            "status": "failed",
            "steps": [{"type": "model_output", "content": [{"type": "text", "text": ""}]}],
            "private_job_text": "SECRET JOB DESCRIPTION",
        }

        with patch("job_agent.gemini_client.requests.post", return_value=response), \
                patch("builtins.print") as print_mock:
            gemini_json_request("p", "s", "test-secret-key", "model", None, "test")

        logged = " ".join(str(c.args[0]) for c in print_mock.call_args_list)
        self.assertNotIn("SECRET JOB DESCRIPTION", logged)
        self.assertNotIn("test-secret-key", logged)
        self.assertIn("private_job_text", logged)  # key names only, never values


if __name__ == "__main__":
    unittest.main()
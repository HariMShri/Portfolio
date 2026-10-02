import json
import os
import subprocess
import sys
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch

from job_agent.feedback_analyst import MIN_SAMPLE, analyze, run_feedback_analysis
from job_agent.models import Job
from job_agent.outcomes import find_job_by_id, load_outcomes, record_outcome
from job_agent.status import AGENT_IDS, StatusPublisher


class JobIdTests(unittest.TestCase):
    def test_job_id_is_stable_across_instances_of_the_same_job(self):
        first = Job("QA Engineer", "Example Co", "Remote", "https://example.invalid/a", "manual")
        second = Job("QA Engineer", "Example Co", "Remote", "https://example.invalid/b", "lever")

        self.assertEqual(first.job_id, second.job_id)
        self.assertTrue(first.job_id)

    def test_job_id_differs_for_different_jobs(self):
        a = Job("QA Engineer", "Example Co", "Remote", "https://example.invalid", "manual")
        b = Job("SDET", "Example Co", "Remote", "https://example.invalid", "manual")

        self.assertNotEqual(a.job_id, b.job_id)

    def test_job_id_is_included_in_serialized_dict(self):
        job = Job("QA Engineer", "Example Co", "Remote", "https://example.invalid", "manual")
        self.assertEqual(job.to_dict()["job_id"], job.job_id)


class OutcomesStoreTests(unittest.TestCase):
    def test_record_and_load_round_trip(self):
        with TemporaryDirectory() as output_dir:
            record_outcome(output_dir, "abc123", "Example Co", "QA Engineer", "interview", note="went well")
            record_outcome(output_dir, "def456", "Other Co", "SDET", "rejected")

            records = load_outcomes(output_dir)

        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["decision"], "interview")
        self.assertEqual(records[0]["note"], "went well")
        self.assertEqual(records[1]["job_id"], "def456")

    def test_rejects_unknown_decision(self):
        with TemporaryDirectory() as output_dir:
            with self.assertRaises(ValueError):
                record_outcome(output_dir, "abc123", "Example Co", "QA Engineer", "ghosted")

    def test_requires_job_id(self):
        with TemporaryDirectory() as output_dir:
            with self.assertRaises(ValueError):
                record_outcome(output_dir, "", "Example Co", "QA Engineer", "applied")

    def test_load_outcomes_on_missing_file_returns_empty(self):
        with TemporaryDirectory() as output_dir:
            self.assertEqual(load_outcomes(output_dir), [])

    def test_load_outcomes_skips_corrupted_lines(self):
        with TemporaryDirectory() as output_dir:
            record_outcome(output_dir, "abc123", "Example Co", "QA Engineer", "applied")
            with open(os.path.join(output_dir, "outcomes.jsonl"), "a", encoding="utf-8") as f:
                f.write("not json at all\n")

            records = load_outcomes(output_dir)

        self.assertEqual(len(records), 1)

    def test_find_job_by_id_searches_report_files(self):
        with TemporaryDirectory() as output_dir:
            report = [{"job_id": "abc123", "company": "Example Co", "title": "QA Engineer"}]
            with open(os.path.join(output_dir, "report_20260101_000000.json"), "w", encoding="utf-8") as f:
                json.dump(report, f)

            found = find_job_by_id(output_dir, "abc123")
            missing = find_job_by_id(output_dir, "nope")

        self.assertEqual(found["company"], "Example Co")
        self.assertIsNone(missing)


class FeedbackAnalystTests(unittest.TestCase):
    def _write_report(self, output_dir, jobs):
        with open(os.path.join(output_dir, "report_20260101_000000.json"), "w", encoding="utf-8") as f:
            json.dump(jobs, f)

    def test_insufficient_data_below_minimum_sample(self):
        with TemporaryDirectory() as output_dir:
            for i in range(MIN_SAMPLE - 1):
                record_outcome(output_dir, f"job{i}", "Co", "QA Engineer", "interview")

            result = analyze(output_dir, {"min_match_score": 35})

        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["proposals"], [])

    def test_flags_underperforming_source_once_enough_resolved_outcomes_exist(self):
        with TemporaryDirectory() as output_dir:
            jobs = []
            for i in range(MIN_SAMPLE):
                jobs.append({"job_id": f"bad{i}", "company": "BadCo", "title": "QA", "source": "linkedin", "match_score": 60})
                jobs.append({"job_id": f"good{i}", "company": "GoodCo", "title": "QA", "source": "greenhouse:acme", "match_score": 60})
            self._write_report(output_dir, jobs)

            for i in range(MIN_SAMPLE):
                record_outcome(output_dir, f"bad{i}", "BadCo", "QA", "rejected")
                record_outcome(output_dir, f"good{i}", "GoodCo", "QA", "interview")

            result = analyze(output_dir, {"min_match_score": 35})

        self.assertEqual(result["status"], "ok")
        proposal_sources = [p["source"] for p in result["proposals"] if p["type"] == "source_deprioritize"]
        self.assertIn("linkedin", proposal_sources)
        self.assertNotIn("greenhouse:acme", proposal_sources)

    def test_no_proposals_when_nothing_underperforms(self):
        with TemporaryDirectory() as output_dir:
            jobs = [{"job_id": f"job{i}", "company": "Co", "title": "QA", "source": "greenhouse:acme", "match_score": 70} for i in range(MIN_SAMPLE)]
            self._write_report(output_dir, jobs)
            for i in range(MIN_SAMPLE):
                record_outcome(output_dir, f"job{i}", "Co", "QA", "interview")

            result = analyze(output_dir, {"min_match_score": 35})

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["proposals"], [])

    def test_run_feedback_analysis_never_raises_on_bad_config(self):
        with TemporaryDirectory() as output_dir:
            with patch("job_agent.feedback_analyst.analyze", side_effect=RuntimeError("boom")), \
                    patch("builtins.print"):
                result, path = run_feedback_analysis(output_dir, {})

        self.assertEqual(result["status"], "error")
        self.assertIsNone(path)

    def test_run_feedback_analysis_writes_dated_proposal_file(self):
        with TemporaryDirectory() as output_dir:
            jobs = [{"job_id": f"job{i}", "company": "Co", "title": "QA", "source": "linkedin", "match_score": 40} for i in range(MIN_SAMPLE)]
            self._write_report(output_dir, jobs)
            for i in range(MIN_SAMPLE):
                record_outcome(output_dir, f"job{i}", "Co", "QA", "rejected")

            with patch("builtins.print"):
                result, path = run_feedback_analysis(output_dir, {"min_match_score": 35})

            self.assertEqual(result["status"], "ok")
            self.assertTrue(os.path.exists(path))
            with open(path, encoding="utf-8") as f:
                self.assertEqual(json.load(f)["status"], "ok")


class FeedbackStatusContractTests(unittest.TestCase):
    def test_feedback_analyst_status_defaults_to_planned(self):
        with patch.dict(os.environ, {
            "STATUS_API_URL": "https://example.invalid/internal/status",
            "STATUS_API_TOKEN": "test-token",
        }), patch("job_agent.status.requests.post") as post:
            StatusPublisher().publish("application-coordinator", "completed")

        agents = {agent["id"]: agent["status"] for agent in post.call_args.kwargs["json"]["agents"]}
        self.assertEqual(agents["feedback-analyst"], "planned")
        self.assertEqual(set(agents), set(AGENT_IDS))

    def test_feedback_analyst_status_is_reported_when_provided(self):
        with patch.dict(os.environ, {
            "STATUS_API_URL": "https://example.invalid/internal/status",
            "STATUS_API_TOKEN": "test-token",
        }), patch("job_agent.status.requests.post") as post:
            StatusPublisher().publish(
                "application-coordinator", "completed", feedback_analyst_status="completed",
            )

        agents = {agent["id"]: agent["status"] for agent in post.call_args.kwargs["json"]["agents"]}
        self.assertEqual(agents["feedback-analyst"], "completed")


class RecordOutcomeCliTests(unittest.TestCase):
    def test_cli_records_outcome_using_explicit_company_and_title(self):
        with TemporaryDirectory() as output_dir:
            script = os.path.join(os.path.dirname(os.path.dirname(__file__)), "record_outcome.py")
            result = subprocess.run(
                [sys.executable, script,
                 "--job-id", "abc123", "--company", "Example Co", "--title", "QA Engineer",
                 "--decision", "applied", "--output-dir", output_dir],
                capture_output=True, text=True, cwd=os.path.dirname(script),
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            records = load_outcomes(output_dir)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["decision"], "applied")

    def test_cli_fails_cleanly_without_job_id(self):
        with TemporaryDirectory() as output_dir:
            script = os.path.join(os.path.dirname(os.path.dirname(__file__)), "record_outcome.py")
            result = subprocess.run(
                [sys.executable, script, "--decision", "applied", "--output-dir", output_dir],
                capture_output=True, text=True, cwd=os.path.dirname(script),
            )

        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()

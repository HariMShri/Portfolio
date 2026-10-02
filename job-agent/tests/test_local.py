"""Tests for the local pipeline: deterministic tailoring, ATS memory, and
the local model client that replaced the hosted API."""
import json
import os
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

import requests

from job_agent import ats_memory, local_llm
from job_agent.local_tailor import normalize, select_evidence, select_skills, term_in_text
from job_agent.models import Job
from job_agent.resume_tailor import validate_resume_plan


PROFILE = {
    "skills": ["Python", "SQL", "Selenium", "Playwright", "Java", "Jenkins", "Cassandra"],
    "experience": [
        {"company": "Current Co", "title": "Senior Test Engineer", "highlights": [
            "Automated regression suites with Playwright and Python",
            "Validated REST APIs and backend data with SQL",
            "Coordinated release sign-off with product owners",
        ]},
        {"company": "Previous Co", "title": "QA Engineer", "highlights": [
            "Built Selenium suites in Java with Jenkins pipelines",
            "Triaged 1,000+ defects across 10 releases",
        ]},
    ],
}


def job_with(description, title="QA Engineer"):
    return Job(title, "Example Co", "Remote", "https://example.invalid", "manual", description=description)


def ollama_response(text, done=True):
    return {"model": "test-model", "response": text, "done": done}


class TermMatchingTests(unittest.TestCase):
    def test_single_words_match_on_boundaries(self):
        """'Java' must not match inside 'JavaScript' -- the classic way
        keyword matching quietly inflates a resume."""
        self.assertFalse(term_in_text("Java", normalize("Strong JavaScript developer")))
        self.assertTrue(term_in_text("Java", normalize("Strong Java developer")))

    def test_phrases_match_as_substrings(self):
        self.assertTrue(term_in_text("API testing", normalize("Hands-on API testing experience")))
        self.assertFalse(term_in_text("API testing", normalize("Hands-on API design experience")))

    def test_matching_is_case_and_punctuation_insensitive(self):
        self.assertTrue(term_in_text("CI/CD", normalize("Owns the ci cd pipeline")))


class LocalTailorTests(unittest.TestCase):
    def test_prefers_skills_the_listing_actually_asks_for(self):
        """Matched skills lead; with no demand signal yet, ties keep profile
        order rather than reshuffling arbitrarily."""
        skills = select_skills(normalize("We need Playwright and SQL skills"), PROFILE)
        self.assertEqual(skills[:2], ["SQL", "Playwright"])
        self.assertLess(skills.index("Playwright"), skills.index("Java"))

    def test_never_returns_a_skill_absent_from_the_profile(self):
        skills = select_skills(normalize("We need Kubernetes, Terraform and Go"), PROFILE)
        for skill in skills:
            self.assertIn(skill, PROFILE["skills"])

    def test_pads_so_a_terse_listing_still_yields_a_resume(self):
        skills = select_skills(normalize("Great team, apply now"), PROFILE)
        self.assertTrue(skills)

    def test_orders_matched_skills_by_market_demand(self):
        demand = {"sql": 900, "playwright": 10}
        skills = select_skills(normalize("Needs Playwright and SQL"), PROFILE, demand)
        self.assertEqual(skills[:2], ["SQL", "Playwright"])

    def test_selects_highlights_relevant_to_the_listing(self):
        job = job_with("Selenium and Java automation with Jenkins CI")
        plan = select_evidence(job, PROFILE)
        previous = next(e for e in plan["experience"] if e["experience_index"] == 1)
        self.assertIn(0, previous["highlight_indices"])  # the Selenium/Java/Jenkins bullet

    def test_output_always_satisfies_the_resume_validator(self):
        for description in [
            "Playwright Python SQL automation",
            "",
            "Completely unrelated pastry chef role",
            "x" * 5000,
        ]:
            plan = select_evidence(job_with(description), PROFILE)
            safe, issues = validate_resume_plan(plan, PROFILE)
            self.assertEqual(issues, [], f"failed for description: {description[:30]!r}")
            self.assertIsNotNone(safe)

    def test_respects_the_twenty_skill_cap(self):
        wide = {**PROFILE, "skills": [f"Skill{i}" for i in range(50)]}
        plan = select_evidence(job_with("anything"), wide)
        self.assertLessEqual(len(plan["skills"]), 20)

    def test_experience_is_presented_in_profile_order(self):
        job = job_with("Selenium Java Jenkins Playwright Python SQL")
        plan = select_evidence(job, PROFILE)
        indices = [entry["experience_index"] for entry in plan["experience"]]
        self.assertEqual(indices, sorted(indices))

    def test_is_deterministic(self):
        job = job_with("Playwright Python SQL automation")
        self.assertEqual(select_evidence(job, PROFILE), select_evidence(job, PROFILE))


class AtsMemoryTests(unittest.TestCase):
    def test_counts_listings_not_repetitions(self):
        """A term repeated ten times in one listing is still one listing."""
        jobs = [job_with("python python python python automation")]
        with TemporaryDirectory() as out:
            memory = ats_memory.observe(jobs, [], PROFILE, out)
        self.assertEqual(memory["terms"]["python"]["jobs"], 1)

    def test_accumulates_across_runs(self):
        with TemporaryDirectory() as out:
            ats_memory.observe([job_with("selenium testing")], [], PROFILE, out)
            memory = ats_memory.observe([job_with("selenium testing")], [], PROFILE, out)
        self.assertEqual(memory["terms"]["selenium"]["jobs"], 2)
        self.assertEqual(memory["runs"], 2)

    def test_tracks_shortlisted_separately(self):
        shortlisted = job_with("playwright automation")
        with TemporaryDirectory() as out:
            memory = ats_memory.observe([shortlisted, job_with("playwright automation")], [shortlisted], PROFILE, out)
        self.assertEqual(memory["terms"]["playwright"]["jobs"], 2)
        self.assertEqual(memory["terms"]["playwright"]["shortlisted"], 1)

    def test_gap_list_is_what_the_market_wants_and_the_profile_lacks(self):
        jobs = [job_with("kubernetes and docker required") for _ in range(3)]
        with TemporaryDirectory() as out:
            memory = ats_memory.observe(jobs, [], PROFILE, out)
        gap_terms = [term for term, _ in ats_memory.gaps(memory, PROFILE)]
        self.assertIn("kubernetes", gap_terms)
        self.assertNotIn("python", gap_terms)  # already on the profile

    def test_stores_no_listing_identifying_content(self):
        """The memory file is the one thing that persists between runs, so it
        must never accumulate job titles, employers or descriptions."""
        job = Job("Secret Title", "SecretCorp", "Remote", "https://secret.invalid", "manual",
                  description="python automation at SecretCorp")
        with TemporaryDirectory() as out:
            ats_memory.observe([job], [], PROFILE, out)
            with open(os.path.join(out, "ats_memory.json"), encoding="utf-8") as f:
                raw = f.read()
        self.assertNotIn("SecretCorp", raw)
        self.assertNotIn("Secret Title", raw)
        self.assertNotIn("secret.invalid", raw)
        self.assertIn("python", raw)

    def test_survives_a_corrupted_memory_file(self):
        with TemporaryDirectory() as out:
            with open(os.path.join(out, "ats_memory.json"), "w", encoding="utf-8") as f:
                f.write("{ not json")
            memory = ats_memory.observe([job_with("python")], [], PROFILE, out)
        self.assertEqual(memory["runs"], 1)

    def test_demand_feeds_skill_ordering(self):
        with TemporaryDirectory() as out:
            memory = ats_memory.observe([job_with("sql") for _ in range(5)] + [job_with("playwright")], [], PROFILE, out)
        demand = ats_memory.demand(memory)
        self.assertGreater(demand["sql"], demand["playwright"])


class LocalLlmTests(unittest.TestCase):
    def test_reads_text_from_the_response_field(self):
        self.assertEqual(local_llm._extract_text(ollama_response("hello")), "hello")

    def test_falls_back_to_chat_message_content(self):
        payload = {"message": {"role": "assistant", "content": "hi"}}
        self.assertEqual(local_llm._extract_text(payload), "hi")

    def test_missing_text_returns_empty_rather_than_raising(self):
        self.assertEqual(local_llm._extract_text({"done": True}), "")
        self.assertEqual(local_llm._extract_text(None), "")

    def test_parses_json_end_to_end(self):
        response = Mock()
        response.json.return_value = ollama_response(json.dumps({"cover_note": "hi", "qa": []}))

        with patch("job_agent.local_llm.requests.post", return_value=response), patch("builtins.print"):
            parsed, error = local_llm.generate_json("p", "s", "m", "test")

        self.assertIsNone(error)
        self.assertEqual(parsed["cover_note"], "hi")

    def test_sends_schema_as_format_and_disables_streaming(self):
        response = Mock()
        response.json.return_value = ollama_response("{}")
        schema = {"type": "object"}

        with patch("job_agent.local_llm.requests.post", return_value=response) as post, patch("builtins.print"):
            local_llm.generate_json("p", "s", "m", "test", schema)

        body = post.call_args.kwargs["json"]
        self.assertEqual(body["format"], schema)
        self.assertFalse(body["stream"])

    def test_strips_code_fences(self):
        response = Mock()
        response.json.return_value = ollama_response('```json\n{"ok": true}\n```')

        with patch("job_agent.local_llm.requests.post", return_value=response), patch("builtins.print"):
            parsed, error = local_llm.generate_json("p", "s", "m", "test")

        self.assertIsNone(error)
        self.assertEqual(parsed, {"ok": True})

    def test_retries_once_on_invalid_json(self):
        bad = Mock()
        bad.json.return_value = ollama_response("not json")
        good = Mock()
        good.json.return_value = ollama_response('{"ok": true}')

        with patch("job_agent.local_llm.requests.post", side_effect=[bad, good]) as post, patch("builtins.print"):
            parsed, error = local_llm.generate_json("p", "s", "m", "test")

        self.assertIsNone(error)
        self.assertEqual(post.call_count, 2)
        self.assertEqual(parsed, {"ok": True})

    def test_unreachable_server_reports_clearly(self):
        with patch("job_agent.local_llm.requests.post", side_effect=requests.ConnectionError), \
                patch("builtins.print"):
            parsed, error = local_llm.generate_json("p", "s", "m", "test")

        self.assertIsNone(parsed)
        self.assertIn("unreachable", error)

    def test_wait_until_ready_gives_up_without_hanging_forever(self):
        with patch("job_agent.local_llm.requests.get", side_effect=requests.ConnectionError), \
                patch("job_agent.local_llm.time.sleep"), patch("builtins.print"):
            # monotonic advances past the deadline on the second check
            with patch("job_agent.local_llm.time.monotonic", side_effect=[0, 1, 999]):
                self.assertFalse(local_llm.wait_until_ready(timeout=5))


if __name__ == "__main__":
    unittest.main()

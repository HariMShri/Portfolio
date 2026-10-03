import json
import os
import unittest
from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from job_agent import applicant
from job_agent.models import Job

PROFILE = {
    "name": "Candidate Name",
    "email": "candidate@example.invalid",
    "phone": "+10000000000",
    "linkedin_url": "https://www.linkedin.com/in/example",
    "github_url": "https://github.com/example",
    "current_company": "Example Employer",
    "summary": "Verified summary.",
    "skills": ["SQL", "Postman"],
    "experience": [{"company": "Example Employer", "title": "Test Engineer", "dates": "2020-2024",
                    "highlights": ["Validated SQL data", "Tested REST APIs in Postman"]}],
    "education": [],
    "certifications": [],
}


def job_dict(source="greenhouse", url="https://example.invalid/careers?gh_jid=4567", company="exampleboard"):
    job = Job("QA Engineer", company, "Remote", url, source, description="SQL and Postman API testing")
    return job.to_dict()


class DestinationTests(unittest.TestCase):
    def test_greenhouse_from_employer_careers_page(self):
        destination = applicant.destination_for(job_dict())
        self.assertEqual(destination["platform"], "greenhouse")
        self.assertEqual(destination["form_url"],
                         "https://job-boards.greenhouse.io/embed/job_app?for=exampleboard&token=4567")

    def test_greenhouse_hosted_url(self):
        destination = applicant.destination_for(job_dict("manual", "https://job-boards.greenhouse.io/acme/jobs/123"))
        self.assertEqual(destination["check_url"], "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123")

    def test_lever(self):
        posting = "0f6c9a1e-1111-2222-3333-444455556666"
        destination = applicant.destination_for(job_dict("lever", f"https://jobs.lever.co/acme/{posting}"))
        self.assertEqual(destination["form_url"], f"https://jobs.lever.co/acme/{posting}/apply")

    def test_boards_that_forbid_automation_are_never_automated(self):
        for source, url in (("linkedin", "https://www.linkedin.com/jobs/view/123"),
                            ("indeed", "https://in.indeed.com/viewjob?jk=abc"),
                            ("naukri", "https://www.naukri.com/job-listings-1")):
            job = job_dict(source, url)
            self.assertIsNone(applicant.destination_for(job))
            self.assertIn("prohibits automated", applicant.manual_reason(job))

    def test_unsafe_board_token_is_rejected(self):
        self.assertIsNone(applicant.destination_for(job_dict(company="bad/board?x=1")))

    def test_split_name_uses_last_word_as_surname(self):
        self.assertEqual(applicant.split_name({"name": "Shri Hari M"}), ("Shri Hari", "M"))
        self.assertEqual(applicant.split_name({"name": "X", "first_name": "A", "last_name": "B"}), ("A", "B"))


class PackageAndApprovalTests(unittest.TestCase):
    def test_package_builds_reviewed_resume_and_reuses_files(self):
        with TemporaryDirectory() as out:
            package = applicant.build_package(job_dict(), PROFILE, out)
            self.assertTrue(Path(package.files["resume"]).read_bytes().startswith(b"%PDF"))
            self.assertNotIn("cover_letter", package.files)
            again = applicant.build_package(job_dict(), PROFILE, out)
            self.assertEqual(package.hashes(), again.hashes())

    def test_cover_letter_only_from_a_usable_draft(self):
        with TemporaryDirectory() as out:
            data = job_dict()
            data["draft_cover_note"] = "[Drafting failed: model offline]"
            self.assertNotIn("cover_letter", applicant.build_package(data, PROFILE, out).files)
        with TemporaryDirectory() as out:
            data["draft_cover_note"] = "I test APIs and data."
            package = applicant.build_package(data, PROFILE, out)
            self.assertIn("cover_letter", package.files)

    def test_valid_approval_has_no_problems(self):
        with TemporaryDirectory() as out:
            package = applicant.build_package(job_dict(), PROFILE, out)
            applicant.approve(out, package, "submit", "tester")
            self.assertEqual(applicant.approval_problems(applicant.latest_approval(out, package.job_id), package), [])

    def test_missing_expired_changed_file_and_destination_all_block(self):
        with TemporaryDirectory() as out:
            package = applicant.build_package(job_dict(), PROFILE, out)
            self.assertEqual(applicant.approval_problems(None, package), ["no approval recorded for this job"])

            approval = json.loads(json.dumps(applicant.approve(out, package, "submit", "tester").__dict__))
            later = applicant._now() + applicant.APPROVAL_TTL + timedelta(minutes=1)
            self.assertIn("approval has expired", applicant.approval_problems(approval, package, later))

            with open(package.files["resume"], "ab") as f:
                f.write(b"edited")
            self.assertIn("files changed since approval", applicant.approval_problems(approval, package))

            package.destination = dict(package.destination, form_url="https://job-boards.greenhouse.io/other")
            self.assertIn("destination changed since approval", applicant.approval_problems(approval, package))

    def test_approval_for_one_job_never_covers_another(self):
        with TemporaryDirectory() as out:
            first = applicant.build_package(job_dict(), PROFILE, out)
            other = applicant.build_package(
                job_dict(url="https://example.invalid/careers?gh_jid=999", company="otherboard"), PROFILE, out)
            applicant.approve(out, first, "submit", "tester")
            self.assertIsNone(applicant.latest_approval(out, other.job_id))

    def test_jobs_without_a_form_cannot_be_approved(self):
        with TemporaryDirectory() as out:
            package = applicant.build_package(job_dict("linkedin", "https://www.linkedin.com/jobs/view/1"), PROFILE, out)
            with self.assertRaises(ValueError):
                applicant.approve(out, package, "submit", "tester")


GREENHOUSE_FORM = """
<form id="application" onsubmit="event.preventDefault(); document.body.innerHTML =
  '<h1>Thank you for applying.</h1>';">
  <label for="first_name">First Name*</label><input id="first_name" required>
  <label for="last_name">Last Name*</label><input id="last_name" required>
  <label for="email">Email*</label><input id="email" type="email" required>
  <label for="phone">Phone</label><input id="phone" type="tel">
  <label for="resume">Resume/CV*</label><input id="resume" type="file" required>
  <label for="cover_letter">Cover Letter</label><input id="cover_letter" type="file">
  <label for="q1">LinkedIn Profile</label><input id="q1" type="text">
  {extra}
  <button type="submit">Submit application</button>
</form>
"""


@unittest.skipUnless(os.environ.get("RUN_BROWSER_TESTS", "1") == "1", "browser tests disabled")
class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from playwright.sync_api import sync_playwright
            cls._pw = sync_playwright().start()
            cls.browser = cls._pw.chromium.launch()
        except Exception as error:  # no browser installed
            raise unittest.SkipTest(f"playwright unavailable: {error}")

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls._pw.stop()

    def run_form(self, extra, scope):
        with TemporaryDirectory() as out:
            package = applicant.build_package(job_dict(), PROFILE, out)
            page = self.browser.new_page()
            page.set_content(GREENHOUSE_FORM.format(extra=extra))
            attempt = applicant.apply_in_page(page, package, PROFILE, scope, confirm_timeout=5)
            values = {key: page.evaluate(f"document.getElementById('{key}')?.value")
                      for key in ("first_name", "last_name", "email", "phone", "q1")}
            page.close()
        return attempt, values

    def test_submits_when_nothing_is_left_to_a_human(self):
        attempt, _ = self.run_form("", "submit")
        self.assertEqual(attempt.status, "submitted")

    def test_fill_scope_never_submits(self):
        attempt, values = self.run_form("", "fill")
        self.assertEqual(attempt.status, "filled")
        self.assertEqual(values["first_name"], "Candidate")
        self.assertEqual(values["last_name"], "Name")
        self.assertEqual(values["q1"], PROFILE["linkedin_url"])

    def test_answer_bank_answers_only_your_questions(self):
        extra = ('<label for="q2">Notice period*</label><input id="q2" required>'
                 '<label for="q3">Expected salary*</label><input id="q3" required>')
        with TemporaryDirectory() as out:
            package = applicant.build_package(job_dict(), PROFILE, out)
            page = self.browser.new_page()
            page.set_content(GREENHOUSE_FORM.format(extra=extra))
            attempt = applicant.apply_in_page(page, package, PROFILE, "submit", confirm_timeout=5,
                                              answers=[{"question": "notice period", "answer": "30 days"}])
            notice = page.evaluate("document.getElementById('q2').value")
            page.close()
        self.assertEqual(notice, "30 days")
        self.assertEqual(attempt.status, "needs_you")
        self.assertEqual(attempt.blockers, ["Expected salary"])

    def test_login_wall_is_never_entered(self):
        with TemporaryDirectory() as out:
            package = applicant.build_package(job_dict(), PROFILE, out)
            page = self.browser.new_page()
            page.set_content('<form><label for="u">Email</label><input id="u">'
                             '<label for="p">Password</label><input id="p" type="password"></form>')
            attempt = applicant.apply_in_page(page, package, PROFILE, "submit", confirm_timeout=5)
            typed = page.evaluate("document.getElementById('u').value")
            page.close()
        self.assertEqual(attempt.status, "login_required")
        self.assertEqual(typed, "")

    def test_custom_required_question_is_left_to_the_user(self):
        extra = '<label for="q2">Are you legally authorised to work here?*</label><select id="q2" required>' \
                '<option value=""></option><option>Yes</option></select>'
        attempt, values = self.run_form(extra, "submit")
        self.assertEqual(attempt.status, "needs_you")
        self.assertEqual(attempt.blockers, ["Are you legally authorised to work here?"])
        self.assertEqual(values["email"], PROFILE["email"])


if __name__ == "__main__":
    unittest.main()

import os as _os

_os.environ["DATABASE_URL"] = ""  # tests never touch the real shared database
import os
import unittest

from job_agent import store


class StoreTests(unittest.TestCase):
    def test_tests_never_see_a_database_url(self):
        self.assertEqual(os.environ.get("DATABASE_URL"), "")

    def test_no_url_means_no_store_and_no_error(self):
        self.assertIsNone(store.Store.open(url=""))
        store.push("outcome", {"job_id": "x", "decision": "applied"})  # silently skipped

    def test_rows_come_back_in_report_shape(self):
        row = ("QA Engineer", "Acme", "Bangalore", "https://x", "greenhouse", "desc", None, 61.0,
               None, {"skills": []}, {"passed": True}, "note", None, "abc123", "onsite",
               {"passed": True, "issues": []}, {"covered": [], "missing": []}, True, "greenhouse:acme")
        job = store.job_dict(row)
        self.assertEqual(job["job_id"], "abc123")
        self.assertEqual(job["draft_cover_note"], "note")
        self.assertEqual(job["match_reasons"], [])
        self.assertEqual(job["draft_qa"], [])
        self.assertTrue(job["is_new"])

    def test_rows_rebuild_jobs_the_applicant_can_use(self):
        from job_agent.applicant import job_from_dict
        row = ("QA Engineer", "acme", "Remote - India", "https://boards.greenhouse.io/acme/jobs/5", "greenhouse",
               "", None, 50.0, [], None, None, None, [], "", "remote_open", None, None, False, "")
        self.assertEqual(job_from_dict(store.job_dict(row)).title, "QA Engineer")


if __name__ == "__main__":
    unittest.main()

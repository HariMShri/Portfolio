# Job Application Agent Workflow

This is the workflow contract for the job-search runner and its agent roles. Role Scout and Fit Analyst use the existing source/search pipeline; Resume Tailor selects verified profile evidence, Application Writer drafts cover notes and answers, Application Reviewer validates resume evidence, and Application Coordinator packages and emails the private review report. These stages currently run sequentially in one Python process, not as independent distributed services. Feedback Analyst now runs every full search run (`job_agent/feedback_analyst.py`), but is data-gated: it needs outcomes the user records manually with `record_outcome.py` (the agent never submits anything, so it has no way to learn what happened on its own) and reports `insufficient_data` honestly until at least 5 resolved outcomes exist. The current system never submits applications.

## Shared Handoff Envelope

Every future agent handoff must include:

```json
{
  "schema_version": 1,
  "job_id": "stable opaque identifier",
  "run_id": "stable identifier for this search run",
  "profile_version": "content hash or version, never profile contents",
  "resume_version": "content hash or version, never resume contents",
  "agent": "role identifier",
  "input_ref": "private durable record reference",
  "result": {},
  "findings": [],
  "created_at": "RFC3339 timestamp"
}
```

Validate the schema and required fields at every boundary. Keep job descriptions, profile data, resume text, drafts, and contact data in private storage only; never put them in public telemetry or logs. Persist state transitions with the job record, not only in process memory, so interrupted runs can resume idempotently.

## Agent Contracts

| Agent | Input | Output | Validation / failure route |
|---|---|---|---|
| **Role Scout** | Search configuration, permitted public sources, manual listings | Normalized listing records with source, canonical URL, full private description, and retrieval timestamp; source health | Validate required listing fields, canonicalize/dedupe; transient source errors retry with bounded backoff, permanent blocks are recorded and not bypassed |
| **Fit Analyst** | Normalized listing, versioned candidate profile | Hard eligibility checks, 0-100 fit score, evidence per factor, rejection reasons | Separate hard gates from weighted score; all claims cite profile/listing evidence; reject below configured threshold or send missing critical facts to user |
| **Resume Tailor** | Fit-approved listing, source resume/profile | Tailored resume plus claim-to-source evidence map and changed sections | Reject unsupported claims, dates, titles, skills, or metrics; revise from reviewer findings at most twice then request user input |
| **Application Writer** | Fit-approved listing, profile evidence, tailored resume | Job-specific cover letter and proposed application answers, including unknowns flagged | Validate output schema, required prompts, relevance and evidence; never guess missing eligibility or personal answers |
| **Application Reviewer** | Listing, profile/resume versions, tailored resume, writer output | Pass/fail with itemized evidence-backed findings and duplicate check | Check factual support, consistency, relevance, completeness, readability, ATS-friendly structure, and destination identity; failures route only to the owning drafter, with at most two revision rounds per artifact before `needs_user_input` |
| **Application Coordinator** | Reviewer-approved package, job record, user decision | Review packet and append-only user decision; future permitted submission result only after explicit per-job approval | Current behavior stops at `awaiting_user_review`; no login or form automation. Any future integration must verify platform permission, destination, final materials, and fresh job-specific approval immediately before action |
| **Feedback Analyst** | Outcomes recorded via `record_outcome.py` (`applied`/`skipped`/`interview`/`rejected`/`offer`/`no_response` per `job_id`), joined against that job's recorded match score and source from past reports | `insufficient_data` below 5 resolved outcomes; otherwise a dated `feedback_proposal_<timestamp>.json` with per-source and per-score-band success rates and any proposals (e.g. deprioritize a source, raise `min_match_score`) | Read-only analysis -- never writes to config.json/profile.json itself; every proposal is a dated, append-only file requiring manual review, so a rejected proposal leaves no trace and a later run's proposal can be diffed against an earlier one |

## States And Transitions

```text
discovered -> normalized -> fit_checked
fit_checked -> rejected_by_fit | materials_drafted
materials_drafted -> quality_checked | needs_user_input
quality_checked -> materials_drafted (failed review, max 2 revisions)
quality_checked -> awaiting_user_review (passed)
awaiting_user_review -> user_skipped | approval_granted
approval_granted -> submission_pending | approval_expired
submission_pending -> user_applied | submission_failed
```

Any nonterminal state may move to `source_unavailable`, `retry_exhausted`, or `job_expired` when its documented recovery condition is met. `user_applied` means the user confirms applying or a permitted, explicitly approved integration returns verifiable success; a drafted package alone must never imply submission. `approval_expired` returns to `awaiting_user_review`, not to submission.

The two-revision limit applies across the artifact's reviewer loop, not per agent call. On exhaustion, stop automated routing and ask the user for input; do not cycle between agents indefinitely.

Each transition records prior state, next state, actor, timestamp, reason, relevant artifact/version references, and an idempotency key. Terminal states are `rejected_by_fit`, `needs_user_input`, `user_skipped`, `user_applied`, `retry_exhausted`, and `job_expired`; a new user action creates a new transition/run rather than rewriting history.

### Recording Outcomes For Feedback Analyst

Run `python record_outcome.py --job-id <id> --decision interview` (or `applied`/`skipped`/`rejected`/`offer`/`no_response`) after you know what happened on a shortlisted job; `--job-id` comes from that job's entry in the latest `output/report_<timestamp>.json`. This appends one line to the gitignored, local-only `output/outcomes.jsonl` -- it is never committed, never sent anywhere, and the only way this data enters the system. The next run's Feedback Analyst step reads it, so proposals only ever reflect outcomes the user explicitly recorded.

### Per-Job Approval Contract (Planned, Not Enabled)

The present implementation only produces reviewable drafts. Do not add a submit operation as part of this status-feed work. If submission is separately authorized for implementation later, require a distinct approval record for every job containing the job ID, canonical destination URL, final artifact hashes, exact action scope, approver, approval timestamp, and expiry. Any edit, destination change, expired listing, or changed application question invalidates approval. Reconfirm the destination and final package immediately before action; then record an auditable result. A missing, stale, mismatched, or revoked approval blocks submission. Approval for one job never carries to another.

## Public Status Contract

`GET /status` exposes only `schema_version`, `updated_at`, `run_status`, aggregate integer counts (`discovered`, `shortlisted`, `drafted`, `resumes_tailored`, `awaiting_review`, `applied`, `skipped`), and the seven stable agent IDs with `status` (`planned`, `idle`, `running`, `completed`, `failed`). It must never return job IDs/titles/companies/URLs/descriptions, candidate data, drafts, application answers, source credentials, or private report paths. The public `applied` count remains zero in the current draft-only system.

The job-agent sends snapshots to an authenticated worker write route. The worker validates and stores only the allowlisted public schema. The UI shows a timestamped unavailable state when the feed is missing, stale, or unreachable; it does not invent live events. Keep the last known status briefly for resilience, but visibly mark it stale.

## Reliability And Operations

- Isolate source failures. Apply source-specific rate limits, timeouts, bounded exponential retry with jitter only for transient failures, and a circuit breaker for repeated failures. Do not retry platform denials or circumvent protections.
- Gemini calls (Resume Tailor, Application Writer) share one client (`job_agent/gemini_client.py`) so both agents fail the same way instead of each inventing its own handling:
  - Transient server errors (500/502/503/504) and network/timeout errors retry up to twice with exponential backoff plus jitter, then fail only that job.
  - A 429 gets one short backoff-and-retry if the server sends a usable `Retry-After`; otherwise the run's remaining Gemini calls pause immediately (`GeminiRunState.rate_limited`) so later jobs fail fast instead of each burning a call against an exhausted quota -- this is what the 2026-10-02 run needed and didn't have, so a single 429 after two already-failed jobs aborted every remaining draft.
  - A non-JSON response retries once with the same prompt (Gemini output is stochastic, so a clean retry is simpler and more reliable than attempting to programmatically repair malformed JSON) before that job alone is marked failed.
  - Every failure path returns a safe, user-facing message only -- never the raw response body or the API key.
- Make worker writes idempotent and bound payload size, model tokens, concurrency, retries, and per-run cost. Retain failed publishing as an operational warning, not a failed job search.
- Monitor run freshness, source health, stage counts, failure rates, latency, draft-review return rates, and cost. Keep personal data out of metric labels.
- Test malformed handoffs, unsupported claims, duplicate listings, source outages, invalid/expired approval, failed review loops, replayed updates, interrupted runs, redaction, and unavailable public status.
- Scale source collection, fit evaluation, drafting, and review independently behind a durable queue when volume justifies it. Preserve per-job ordering and idempotency; use dead-letter records and replay controls for exhausted tasks.
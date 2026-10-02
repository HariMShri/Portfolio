# Job Search Agent

Searches job listings, scores them against `profile.json`, drafts tailored
application materials for the shortlist using the Gemini API, writes a local
PDF + HTML report, and emails you a daily digest with the PDF attached.
**It does not submit anything anywhere** — you review each draft and apply
manually on the original listing.

Runs automatically once every 24 hours via
[`.github/workflows/daily-job-search.yml`](../.github/workflows/daily-job-search.yml)
in this repo (GitHub Actions), so it works without your machine being on. You
can also run it locally any time — see below.

## Why it works this way

Most job platforms' Terms of Service prohibit automated bots, and LinkedIn/
Naukri actively detect and block them. Submitting applications automatically
also tends to produce generic, mismatched applications under your real name,
which can hurt more than help. So this agent:

- Only reads public, unauthenticated pages — no login, no stored credentials,
  no account automation, ever.
- Never submits a form. It drafts materials into a report; a human (you)
  reads them, edits them, and clicks submit on the real site.
- Degrades gracefully. If a source blocks the request or changes its markup,
  that source just returns zero results instead of crashing the run.

## Sources and their actual status (tested, not assumed)

| Source | Method | Status |
|---|---|---|
| Greenhouse | Official public JSON API | Reliable |
| Lever | Official public JSON API | Reliable |
| Indeed | Headless browser (Playwright) against public search | Works, but best-effort — Indeed blocks plain HTTP requests outright (403) and could tighten browser-based blocking later |
| LinkedIn | Plain HTTP request against the public "guest" jobs search page | Works, but LinkedIn may rate-limit/block the IP if run too often — this only makes one request per run by design |
| Naukri | — | **Confirmed blocked.** Naukri is a JS-rendered app behind Akamai bot protection that returns "Access Denied" to headless browsers. This agent does not attempt to bypass that. Use `manual_jobs.json` to paste in specific Naukri listings you find yourself instead. |

## Running it automatically (GitHub Actions)

The scheduled workflow needs two repo secrets. Go to
**github.com/HariMShri/Portfolio → Settings → Secrets and variables →
Actions → New repository secret** and add both (never paste API keys into a
chat or commit them to the repo):

- `GEMINI_API_KEY` — from aistudio.google.com/apikey (free tier; see Cost below)
- `RESEND_API_KEY` — from resend.com (free tier is plenty for one email/day).
  Sign up, verify your account, create an API key. No domain verification
  needed — this uses Resend's shared `onboarding@resend.dev` sending address
  by default (see `config.json` → `notify.from_email` if you later verify
  your own domain and want a nicer from-address).

Once both secrets are set, the workflow runs on its own daily (03:00 UTC /
08:30 IST — GitHub schedule triggers aren't exact-to-the-minute). To test it
immediately instead of waiting: **Actions tab → Daily Job Search Digest → Run
workflow**.

### Optional live portfolio status

The AI & Automation section can show aggregate-only progress from the latest
job-agent run. The worker needs a Cloudflare KV namespace bound as
`JOB_STATUS`, plus a `JOB_STATUS_TOKEN` secret. Create a namespace with
`npx wrangler kv namespace create JOB_STATUS`, then add the returned namespace
ID under `kv_namespaces` in `ai-worker/wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  { "binding": "JOB_STATUS", "id": "<namespace-id>" }
]
```

Set the Worker secret with `npx wrangler secret put JOB_STATUS_TOKEN` and use
the same high-entropy value as the GitHub Actions secret `STATUS_API_TOKEN`.
Set the Actions variable `STATUS_API_URL` to
`https://<worker-host>/internal/status`. The writer endpoint accepts only the
allowlisted aggregate contract; `GET https://<worker-host>/status` is public
and contains no job-level or candidate information. Without this binding and
configuration the website shows a status-unavailable state, and job search
continues normally. Never publish report JSON or add job details to this feed.

The seven-role contracts, state transitions, recovery rules, and planned
per-job approval gate are documented in [`WORKFLOW.md`](WORKFLOW.md). The
runner remains draft-only: status-feed setup does not authorize or enable
application submission.

Each run emails a digest to `config.json` → `notify.to_email` (defaults to
your own address) — either the day's matches or an explicit "no matches
today" email, so you get a signal every 24 hours either way.

Note: this repo is public, so anyone can see the workflow's run logs in the
Actions tab. The logs only show source names and job *counts*, never job
titles/companies/descriptions — those only ever go into the (gitignored,
never-committed) local report and the private email.

## Running it locally

```
pip install -r requirements.txt
python -m playwright install chromium
```

Copy `.env.example` to `.env` and add your own `GEMINI_API_KEY` and
`RESEND_API_KEY` (aistudio.google.com/apikey / resend.com). Never commit
`.env` — it's already in `.gitignore`. Keep the tracked `.env.example` as
placeholders only. If a real key was put in that example file, revoke it and
create a replacement before using the agent.

Edit `profile.json` if anything about your background changes, and
`config.json` to:
- add/remove companies in `greenhouse_boards` / `lever_boards` (only companies
  that actually use those ATS platforms will return results — check a
  company's careers page URL for `boards.greenhouse.io` or `jobs.lever.co`)
- adjust `indeed.query` / `linkedin.query`, add/remove cities in
  `indeed.locations` / `linkedin.locations` / `naukri.locations` (each city
  is searched separately and merged — add as many as you want)
- adjust `min_match_score`, and `profile.json` → `target_locations` (used for
  scoring, separate from the source-level `locations` used for searching)
- change `notify.to_email` / disable `notify.enabled` if you don't want an
  email on every local test run

```
python main.py
```

Output lands in `output/report_<timestamp>.pdf` (the one emailed to you),
`.html` (same content, for quickly opening in a browser), `.json` (raw data),
and one `resume_<timestamp>_<job>.html` per valid tailored resume. Resume
drafts are built by selecting and ordering exact highlights and skills from
`profile.json`; the source PDF is left unchanged. All output is gitignored and
never committed.

## Recording outcomes (Feedback Analyst)

The agent never submits anything, so it has no way to know on its own
whether a shortlisted job led anywhere. After you apply, hear back, or get
an interview/offer, tell it:

```
python record_outcome.py --job-id <id> --decision interview
```

`--job-id` is in each job's entry in the latest `output/report_<timestamp>.json`
(a stable id derived from company+title, not tied to a single run). Valid
`--decision` values: `applied`, `skipped`, `interview`, `rejected`, `offer`,
`no_response`. This appends one line to the gitignored `output/outcomes.jsonl`
— local-only, never committed, never sent anywhere.

Once 5+ outcomes are resolved (interview/offer/rejected/no_response), the
next run's Feedback Analyst step looks for a source or match-score band that's
clearly underperforming and writes a dated, advisory
`output/feedback_proposal_<timestamp>.json` — it never edits `config.json` or
`profile.json` itself; you review and apply any change by hand. Below that
threshold it says `insufficient_data` rather than guessing from too little
signal. See [`WORKFLOW.md`](WORKFLOW.md) for the full contract.

## Adding jobs manually (e.g. from Naukri)

Copy `manual_jobs.example.json` to `manual_jobs.json` and add entries — title,
company, location, url, source, and the full description text (the more
description text you paste in, the better both the match score and the
drafted cover note will be). These flow through the same scoring + drafting
pipeline as everything else.

## Cost

Each run calls Gemini at most twice for each of the top two shortlisted jobs
by default: once for resume evidence selection and once for application
materials. The full shortlist is still reported; change
`config.json` → `max_ai_jobs_per_run` to adjust the number receiving AI
materials.

The cap is 2 rather than 4 because of measured free-tier behaviour, not
caution: a run on 2026-10-02 with the cap at 4 got through 6 calls before
Gemini returned HTTP 429, and a 13-second wait was not enough to clear it.
At 4 jobs that produced 4 tailored resumes but only 1 cover note; at 2 jobs
the run fits inside the quota and both jobs get a complete package. A
rate-limit response stops further Gemini requests in that run. Gemini uses
`gemini-3.6-flash` by default (see `config.json` → `gemini_model`); check
current limits at ai.google.dev/gemini-api/docs/pricing before raising the
per-run cap.

Originally built against the Anthropic API, then switched to Gemini to avoid
needing a paid key. Also considered GitHub Models (would have meant zero new
secrets at all, reusing the workflow's built-in `GITHUB_TOKEN`) but that
service was fully retired on July 30, 2026, so it's not an option.

# Job Search Agent

Searches job listings, scores them against `profile.json`, drafts tailored
application materials for the shortlist using a local model, writes a local
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

The scheduled workflow needs one repo secret. Go to
**github.com/HariMShri/Portfolio → Settings → Secrets and variables →
Actions → New repository secret** (never paste API keys into a chat or
commit them to the repo):

- `RESEND_API_KEY` — from resend.com (free tier is plenty for one email/day).
  Sign up, verify your account, create an API key. No domain verification
  needed — this uses Resend's shared `onboarding@resend.dev` sending address
  by default (see `config.json` → `notify.from_email` if you later verify
  your own domain and want a nicer from-address).

Once that secret is set, the workflow runs on its own daily (03:00 UTC /
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

Copy `.env.example` to `.env` and add your own `RESEND_API_KEY`
(resend.com). For cover notes locally, install Ollama and run
`ollama pull llama3.2:3b`; without it the run still produces the shortlist
and tailored resumes. Never commit
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
and, per valid tailored resume, a `resume_<timestamp>_<job>.html` plus a
send-ready `resume_<timestamp>_<n>_<company>_<role>.pdf`. The digest email
attaches each of those PDFs as `Resume_<Name>_<company>_<role>.pdf`. Resume
drafts are built by selecting and ordering exact highlights and skills from
`profile.json`; the source PDF is left unchanged. All output is gitignored and
never committed.

## Where jobs come from (Role Scout)

- **Company job boards** (`greenhouse_boards`, `lever_boards`, `ashby_boards`,
  `smartrecruiters_companies`, `workday_sites` in `config.json`): each
  board's public JSON feed for candidates.
- **Company careers pages** (`career_pages`): the agent works out which
  system the page uses -- from links in the page, one hop to its "open roles"
  page, or the requests the page makes when rendered -- and reads that feed.
  Pages with schema.org `JobPosting` data are read directly. robots.txt is
  honoured. Pages behind a login are reported and skipped: the agent never
  signs in to any account.
- **Remote roles**: Remotive's public API, LinkedIn's remote filter and
  Indeed India's remote search. The Fit Analyst only keeps remote roles open
  to candidates in India (`job_agent/remote.py`); "Remote -- US only" and
  onsite roles abroad are excluded.
- LinkedIn, Indeed and Naukri public searches as before.

### Career memory

`output/career_memory.json` (Actions cache in CI, never committed) remembers
each board's last status and yield. A board that 404s twice is parked for a
week and one behind a login for a month, so runs stop wasting time on them;
the run log lists the most productive and the parked boards. It also
remembers which careers page uses which system, which jobs were already
seen (so the email and report mark **NEW** jobs and list them first), and
what applying on each platform has needed. Only board IDs from config,
hashed job IDs, dates and counts are stored.

### What changed in scoring and drafting

- Skills match as whole terms ("SQL" no longer matches "NoSQL"), weighted by
  how often the market asks for them once the ATS memory has enough data.
- Tailored materials go first to jobs the Applicant can submit
  (`prefer_auto_apply`), then to new jobs, then by score.
- Each resume PDF is kept to one page by dropping the least relevant
  highlights; the report lists the skills each job asks for that you have and
  the ones you don't (never added to the resume).
- The Application Reviewer fact-checks every cover note: any number, tool or
  employer not in `profile.json` fails it, the report flags it, and the
  Applicant won't send it. Mentioning a skill you're *learning* is fine.
- Optional `writing_sample` in `profile.json`: a paragraph in your own words
  that the Application Writer matches for tone (never for facts).

## Applying on your behalf (Applicant)

```
python apply.py                  # list jobs in the latest report and how each can be applied to
python apply.py --job-id <id>    # prepare, approve and apply to one job
python apply.py --all            # every job with a Greenhouse/Lever form, one approval each
```

Run it locally after `python main.py`. For each job it builds a tailored
resume PDF (plus a cover letter PDF when a usable draft exists) under
`output/applications/<job_id>/`, shows you the files, the cover note and the
exact form URL, and asks: **submit for me**, **fill the form and I'll press
submit**, or skip. Your answer is stored as an approval tied to that job, URL
and the SHA-256 of each file, valid for 24 hours; any change to a file or the
destination needs a new approval.

It then checks the posting is still open, opens the employer's form in a
visible browser and enters your name, email, phone, links and files from
`profile.json`. It submits only when you chose "submit for me" **and** no
required field is left: employer-specific questions (work authorisation,
notice period, salary, demographics) and CAPTCHAs are always left for you to
answer in that window. A confirmed submission is recorded as `applied` for
Feedback Analyst; attempts are logged to `output/applications.jsonl`.

**Answer bank.** Copy `application_answers.example.json` to
`application_answers.json` (gitignored -- the repo is public) and write your
own answers to questions employers repeat. The Applicant fills a field only
when its label matches one of your questions and the field is empty; every
other question still comes back to you. If a form shows a sign-in page the
Applicant stops and hands it to you; it never logs in to any account.

Only Greenhouse and Lever forms are automated. LinkedIn, Indeed and Naukri
prohibit automated applications (accounts get banned), so for those jobs the
Applicant prepares the files and opens the listing for you to apply. Name
split for forms: the last word of `name` is the surname; set `first_name` and
`last_name` in `profile.json` to override.

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

## Cost and the local model

Nothing here calls a paid API. Evidence selection is deterministic Python,
and the cover note runs on a small local model (Ollama, `llama3.2:3b` by
default -- see `config.json` -> `local_model`) inside the GitHub Actions
runner. There is no API key to manage and no quota to exhaust; your profile
and the job descriptions never leave the runner.

The cost moved from money to wall-clock time: generation is CPU-only, so
each cover note takes roughly a minute. `max_ai_jobs_per_run` (default 3)
is what bounds the run, and the workflow allows 45 minutes. The model is
cached between runs, so only the first run after a model change pays the
download.

Why local rather than a hosted API: evidence selection never needed a model
at all -- it returns indexes into `profile.json`, and anything outside the
profile is rejected -- so half the calls were spent asking a hosted model to
do keyword matching. Only the cover note genuinely needs generation, and a
small local model is adequate for a draft that you edit before sending.

### If generation is unavailable

If the model server does not come up, the run still completes: you get the
scored shortlist, tailored resumes and the digest, with the cover note
marked as failed. Search never depends on the model.

### ATS memory

Every run folds the listings it fetched into `output/ats_memory.json`:
per-term counts of what employers asked for, across all listings and across
the ones that cleared the match bar. Resume Tailor orders skills by that
demand, and the gap list shows terms the market keeps asking for that are
absent from `profile.json`. Only aggregate counts are stored -- never a
title, company, URL or description. In CI it lives in the Actions cache, so
it accumulates across runs without ever entering this public repo.

Originally built against the Anthropic API, then switched to Gemini to avoid
needing a paid key, and finally moved off hosted APIs altogether. The free
tier turned out to be the binding constraint: a run capped at 4 jobs made 8
calls and hit HTTP 429 partway through, so most days produced partial
materials. Also considered GitHub Models (would have meant zero new secrets
at all, reusing the workflow's built-in `GITHUB_TOKEN`) but that service was
fully retired on July 30, 2026. Running locally removed the quota, the key
and the per-call cost in one step, at the price of slower generation.

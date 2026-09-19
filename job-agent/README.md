# Job Search Agent

Searches job listings, scores them against `profile.json`, drafts tailored
application materials for the shortlist using Claude, writes a local HTML
report, and emails you a daily digest. **It does not submit anything
anywhere** — you review each draft and apply manually on the original
listing.

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

- `ANTHROPIC_API_KEY` — from console.anthropic.com → API Keys
- `RESEND_API_KEY` — from resend.com (free tier is plenty for one email/day).
  Sign up, verify your account, create an API key. No domain verification
  needed — this uses Resend's shared `onboarding@resend.dev` sending address
  by default (see `config.json` → `notify.from_email` if you later verify
  your own domain and want a nicer from-address).

Once both secrets are set, the workflow runs on its own daily (03:00 UTC /
08:30 IST — GitHub schedule triggers aren't exact-to-the-minute). To test it
immediately instead of waiting: **Actions tab → Daily Job Search Digest → Run
workflow**.

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

Copy `.env.example` to `.env` and add your own Anthropic API key and
`RESEND_API_KEY` (console.anthropic.com / resend.com). Never commit `.env` —
it's already in `.gitignore`.

Edit `profile.json` if anything about your background changes, and
`config.json` to:
- add/remove companies in `greenhouse_boards` / `lever_boards` (only companies
  that actually use those ATS platforms will return results — check a
  company's careers page URL for `boards.greenhouse.io` or `jobs.lever.co`)
- adjust `search_keywords`, `search_locations`, `min_match_score`
- change `notify.to_email` / disable `notify.enabled` if you don't want an
  email on every local test run

```
python main.py
```

Output lands in `output/report_<timestamp>.html` (open in a browser) and the
matching `.json` (raw data, useful if you want to script something on top of
it later) — both gitignored, never committed.

## Adding jobs manually (e.g. from Naukri)

Copy `manual_jobs.example.json` to `manual_jobs.json` and add entries — title,
company, location, url, source, and the full description text (the more
description text you paste in, the better both the match score and the
drafted cover note will be). These flow through the same scoring + drafting
pipeline as everything else.

## Cost

Each run calls the Anthropic API once per shortlisted job (not per job
fetched — only ones that clear `min_match_score`). Check current pricing at
anthropic.com/pricing before running against a large shortlist.

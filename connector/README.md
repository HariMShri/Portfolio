# Career connector

Shri Hari's job-search data as a **Claude custom connector** (a remote MCP
server) and a **private dashboard**, on one Cloudflare Worker. Both read the
job agent's Neon database and are locked to one GitHub account.

| Path | What |
|---|---|
| `/mcp` | MCP server. Add it in claude.ai as a custom connector. |
| `/dashboard` | Shortlist, packages (resume, fact-checked cover note, skill gap), Submit / Fill only / Skip, outcomes, insights. |
| `/authorize`, `/callback` | Sign-in for Claude: consent page, then GitHub. |

## Tools Claude gets

| Tool | Does |
|---|---|
| `pipeline_status` | Latest run, jobs awaiting you, approvals waiting for apply.py, outcomes |
| `list_shortlist` | Today's jobs; filters: new, apply-ready, remote, undecided |
| `get_job` | One job's listing, tailored resume, cover note + fact check, skill gap |
| `career_insights` | Most-requested skills, your gaps, productive and parked boards |
| `decide_job` | Record submit / fill / skip -- only on your explicit instruction |
| `record_outcome` | Log applied / interview / rejected / offer / no_response / skipped |

Nothing here submits an application. A decision is recorded with the hash of
the exact package the daily run stored; `python apply.py` on your PC carries
it out within 48 hours after re-checking that hash.

## Security

- **One account.** Only `ALLOWED_GITHUB_LOGIN` can sign in, to Claude or the
  dashboard; tokens are only ever issued to it, and checked again on every
  MCP call.
- **OAuth 2.1** via `@cloudflare/workers-oauth-provider`: PKCE, a consent page
  per client that can't be framed or forged, state bound to the browser.
  Client names are escaped; a localhost redirect gets a warning.
- **Listing text is untrusted.** Tool results label it as data; `decide_job`
  says to act only on the user's explicit instruction. The dashboard inserts
  every value as text under a nonce-based CSP, and its writes must be
  same-origin JSON.
- **Secrets** live only in Worker secrets. GitHub tokens are used once to
  learn the login, then dropped. SQL is always parameterised.

## Set up (once)

1. **GitHub OAuth app.** GitHub → Settings → Developer settings → OAuth Apps →
   New OAuth App.
   - Homepage URL: `https://shrihari-career-connector.shriharigamer.workers.dev`
   - Authorization callback URL: `https://shrihari-career-connector.shriharigamer.workers.dev/callback`
   - Then generate a client secret.
2. **KV for OAuth state.** In this folder:
   ```
   npm install
   npx wrangler kv namespace create OAUTH_KV
   ```
   Put the printed `id` into `wrangler.jsonc` in place of `REPLACE_WITH_OAUTH_KV_ID`.
3. **Secrets** (each command prompts; paste the value there, never in a chat):
   ```
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler secret put COOKIE_SECRET      # 32+ random characters
   npx wrangler secret put DATABASE_URL       # the same Neon string as the job agent
   ```
4. **Deploy:** `npx wrangler deploy`. If the printed address isn't
   `shrihari-career-connector.shriharigamer.workers.dev`, put the real one in
   `PUBLIC_URL` in `wrangler.jsonc` and in the GitHub app, then deploy again.
5. **Claude:** Settings → Connectors → Add custom connector → URL
   `https://shrihari-career-connector.shriharigamer.workers.dev/mcp`. Claude
   shows the consent page, then GitHub sign-in.

## Develop

`npm test` runs the tests (data queries against a fake database, sessions,
dashboard protections, and the tools through the real MCP handler).
`npx wrangler dev` runs it locally with a `.dev.vars` file (gitignored)
holding the same secrets plus `PUBLIC_URL=http://127.0.0.1:8787`.

## Building more apps on it

New capabilities go in two places: a query in `src/data.js`, then a tool in
`src/tools.js` (Claude) and/or a dashboard panel in `src/dashboard.js`. The
job agent writes everything to Neon, so any app can read the same
shortlist, packages, outcomes and memories.

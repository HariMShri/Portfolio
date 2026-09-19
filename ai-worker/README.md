# Portfolio AI Worker

A small Cloudflare Worker that proxies chat requests from the portfolio's AI
assistant widget to the Gemini API. Exists purely so the API key never has
to be shipped to the browser (this site is static/GitHub Pages, it can't
hold a secret on its own).

## How it fits together

```
Browser (harimshri.github.io)
  --POST { message }-->
Cloudflare Worker (this project, holds GEMINI_API_KEY as a secret)
  --calls-->
Gemini API
  --text reply-->
Worker --JSON { reply }--> Browser
```

If the Worker call fails for any reason (rate limited, API down, not yet
deployed), the widget's JS catches that and falls back to the original
local keyword-matched replies — the chat never just breaks.

## Guardrails built in

- **CORS-locked** to `https://harimshri.github.io` only — the endpoint
  refuses requests from any other origin.
- **Rate limited** to 8 requests/minute per IP (see `wrangler.jsonc`) —
  protects the free Gemini quota from being burned by abuse/scripts hitting
  a public endpoint.
- **System-prompt constrained** — told explicitly to only use the facts
  given to it about Shri Hari, never invent employers/numbers/skills.
- **Input capped** at 500 characters per message.

## Deploy it (one-time, needs your own Cloudflare account)

I can't do this part for you — it needs an interactive browser login to
your own Cloudflare account, which isn't something I can run from here.

```
cd ai-worker
npm install
npx wrangler login          # opens a browser, sign in / sign up (free, no card needed)
npx wrangler secret put GEMINI_API_KEY
                             # paste your Gemini key when prompted (get one free at
                             # aistudio.google.com/apikey if you don't already have one)
npx wrangler deploy
```

The deploy command prints a URL like
`https://shrihari-portfolio-ai.<your-subdomain>.workers.dev` — send me that
URL and I'll wire it into the widget's JS (`js/script.js`) and commit it.

## Local testing (optional)

```
cp .dev.vars.example .dev.vars
# edit .dev.vars, add your real key
npm run dev
```

Then `curl -X POST http://localhost:8787 -H "Origin: https://harimshri.github.io" -H "Content-Type: application/json" -d '{"message":"What are your skills?"}'`

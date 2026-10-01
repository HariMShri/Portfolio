# Portfolio AI Worker

A small Cloudflare Worker that proxies chat requests from the portfolio's AI
assistant widget to the Gemini API. Exists purely so the API key never has
to be shipped to the browser (this site is static/GitHub Pages, it can't
hold a secret on its own).

It also proxies cloned-voice text-to-speech through Cartesia. The Cartesia
API key remains a Worker secret; the configured voice ID is
`99b5248d-caa2-47e3-ae22-9e6567ce4123`.

## How it fits together

```
Browser (harimshri.github.io)
  --POST { message }-->
Cloudflare Worker (this project, holds GEMINI_API_KEY as a secret)
  --calls-->
Gemini API
  --text reply-->
Worker --JSON { reply }--> Browser

Browser --POST { text }--> Worker (holds CARTESIA_API_KEY)
  --voice ID + text--> Cartesia
  --WAV/PCM bytes--> Worker --> Browser audio playback
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
- **Voice generation capped** at 1,200 characters per request and 12 requests
  per minute per IP. Voice responses are not cached.

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
npx wrangler secret put CARTESIA_API_KEY
                             # paste your Cartesia API key at the prompt; never put it in site JS
npx wrangler deploy
```

The assistant still plays its local recorded FAQ clips first. For live Gemini
replies and when a clip cannot play, it requests cloned-voice WAV from
`POST /tts`; if Cartesia is not configured or fails, browser speech synthesis
is used. The TTS route only accepts the portfolio origin and uses a separate
per-IP rate limit. Deploy the Worker after setting the secret to enable it.

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

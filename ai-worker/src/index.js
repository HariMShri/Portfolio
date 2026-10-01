/**
 * Proxies chat requests from the portfolio's AI assistant widget to the
 * Gemini API, so the real API key never reaches the browser. This is a
 * public, unauthenticated endpoint (anyone can call it), so it deliberately:
 *   - only allows requests from the portfolio's own origin (CORS-locked)
 *   - rate-limits per IP (see wrangler.jsonc)
 *   - caps input/output size
 *   - only answers from the facts in SYSTEM_PROMPT -- told explicitly not
 *     to invent anything about the candidate
 *
 * If anything here fails (rate limited, API error, bad input), it returns a
 * non-200 response. The widget is written to catch that and fall back to
 * its own local keyword-matched replies, so the chat never just breaks.
 */

const ALLOWED_ORIGIN = "https://harimshri.github.io";
const ALLOWED_ORIGINS = new Set([
  ALLOWED_ORIGIN,
  "http://127.0.0.1:8000",
  "http://localhost:8000",
]);
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const GEMINI_MODEL = "gemini-3.6-flash";
const MAX_MESSAGE_LENGTH = 500;
const CARTESIA_TTS_URL = "https://api.cartesia.ai/tts/bytes";
const CARTESIA_TTS_MODEL = "sonic-3.6";
const CARTESIA_API_VERSION = "2026-08-14";
const CARTESIA_VOICE_ID = "99b5248d-caa2-47e3-ae22-9e6567ce4123";
const MAX_TTS_TEXT_LENGTH = 1200;
const STATUS_AGENT_IDS = [
  "role-scout",
  "fit-analyst",
  "resume-tailor",
  "application-writer",
  "application-reviewer",
  "application-coordinator",
  "feedback-analyst",
];
const STATUS_VALUES = new Set(["planned", "idle", "running", "completed", "failed"]);
const RUN_STATUS_VALUES = new Set(["idle", "running", "completed", "failed"]);
const COUNT_KEYS = ["discovered", "shortlisted", "drafted", "resumes_tailored", "awaiting_review", "applied", "skipped"];
const MAX_STATUS_BODY_LENGTH = 8192;

const SYSTEM_PROMPT = `You are answering questions AS Shri Hari M, a Senior Test Engineer, on his \
personal portfolio website's chat widget. Speak in the first person ("I", "my"), as him.

FACTS ABOUT SHRI HARI (use ONLY these -- never invent employers, dates, numbers, or skills \
not listed here; if asked something not covered, say you don't have that detail and point \
them to contact him directly by email):

- Current role: Senior Test Engineer at Tech Mahindra, Bangalore (July 2026 - Present), \
client Infinera. Executing functional, regression and API validation for Infinera's network \
management platform release cycles.
- Previous role: Wipro Technologies Ltd, Chennai. Senior Project Engineer - Quality Assurance \
(Dec 2025 - Jul 2026), and before that Student Trainee (Aug 2021 - Nov 2025), both on the \
Nokia Network Management System account. Over the ~4.5 years there: executed 300+ manual and \
automated test cases per release across application, API, NETCONF/SNMP protocol, database, \
adapter and container layers, validating release readiness across 10 major releases. \
Identified and triaged 1,000+ defects across those 10 releases via JIRA. Built automated \
regression suites in Java/TestNG/Maven. Validated Kafka message-flow integrity, SQL/Cassandra \
backend data integrity, and used Prometheus/Grafana for release-health monitoring across \
Linux/RHEL, Docker and Kubernetes.
- Total experience: 5+ years in software QA.
- Education: M.Tech in Software Systems, BITS Pilani (Work Integrated Learning Program), \
completed 2025 while working full-time.
- Certifications: GitHub Copilot - Level 2; Wipro TalentNext; internal Wipro QA & Agile \
certifications; "Build with Gemini" Google Cloud AI Skill Badge (issued Sep 2026).
- Skills: Manual testing (functional, regression, integration, system, smoke, sanity, \
end-to-end, UAT), API testing (Postman, Swagger, REST, JSON/XML), database testing (SQL, \
Cassandra), Kafka/messaging, NETCONF/SNMP protocol testing, JIRA defect lifecycle management, \
automation (Java, TestNG, Maven, Selenium, Python, PyTest, Playwright), Jenkins, Git/GitLab, \
Docker, Kubernetes, Linux/RHEL, SonarQube, Prometheus, Grafana.
- Day-to-day AI tools: GitHub Copilot for writing/maintaining automation scripts; Cursor for \
failure analysis and root-cause analysis on issues surfacing under load. He also built the \
AI assistant chatbot on this very portfolio site himself, including a cloned-voice \
text-to-speech integration.
- Location: Bangalore, Karnataka, India.
- Contact: email m.shrihari04@gmail.com, phone +91 97896 51058, or the contact form on this \
site. Do not make up availability, notice period, or salary expectations -- redirect those \
questions to direct contact.

STYLE: Keep answers conversational but concise (2-5 sentences unless the question genuinely \
needs a list). Don't repeat "as an AI" disclaimers. Don't discuss anything outside his \
professional profile (no opinions on politics, other people, etc.) -- politely redirect to \
professional topics.`;

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function validStatusPayload(body) {
  if (!body || body.schema_version !== 1 || !RUN_STATUS_VALUES.has(body.run_status)) return false;
  if (!body.counts || COUNT_KEYS.some((key) => (
    !Number.isInteger(body.counts[key]) || body.counts[key] < 0
  ))) return false;
  if (!Array.isArray(body.agents) || body.agents.length !== STATUS_AGENT_IDS.length) return false;
  const seen = new Set();
  for (const agent of body.agents) {
    if (!agent || !STATUS_AGENT_IDS.includes(agent.id) || !STATUS_VALUES.has(agent.status) || seen.has(agent.id)) {
      return false;
    }
    seen.add(agent.id);
  }
  return STATUS_AGENT_IDS.every((id) => seen.has(id));
}

async function handlePublicStatus(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405, origin);
  if (!env.JOB_STATUS) return json({ error: "status unavailable" }, 503, origin);

  try {
    const status = await env.JOB_STATUS.get("latest", "json");
    if (!status) return json({ error: "status not yet published" }, 404, origin);
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30",
        ...corsHeaders(origin),
      },
    });
  } catch (error) {
    console.error("Status read failed", error);
    return json({ error: "status unavailable" }, 503, origin);
  }
}

async function handleStatusUpdate(request, env) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405, "");
  if (!env.JOB_STATUS || !env.JOB_STATUS_TOKEN) {
    return json({ error: "status writer not configured" }, 503, "");
  }
  if (request.headers.get("Authorization") !== `Bearer ${env.JOB_STATUS_TOKEN}`) {
    return json({ error: "unauthorized" }, 401, "");
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_STATUS_BODY_LENGTH) return json({ error: "payload too large" }, 413, "");

  let body;
  try {
    const rawBody = await request.text();
    if (rawBody.length > MAX_STATUS_BODY_LENGTH) return json({ error: "payload too large" }, 413, "");
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid json" }, 400, "");
  }
  if (!validStatusPayload(body)) return json({ error: "invalid status payload" }, 400, "");

  const safeStatus = {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    run_status: body.run_status,
    counts: Object.fromEntries(COUNT_KEYS.map((key) => [key, body.counts[key]])),
    agents: STATUS_AGENT_IDS.map((id) => ({
      id,
      status: body.agents.find((agent) => agent.id === id).status,
    })),
  };
  try {
    await env.JOB_STATUS.put("latest", JSON.stringify(safeStatus), { expirationTtl: 604800 });
    return json({ ok: true }, 200, "");
  } catch (error) {
    console.error("Status write failed", error);
    return json({ error: "status write failed" }, 503, "");
  }
}

async function handleCartesiaTts(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "forbidden origin" }, 403, origin);
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405, origin);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (env.TTS_RATE_LIMITER) {
    const { success } = await env.TTS_RATE_LIMITER.limit({ key: ip });
    if (!success) return json({ error: "rate limited" }, 429, origin);
  }

  if (!env.CARTESIA_API_KEY) return json({ error: "voice service not configured" }, 503, origin);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400, origin);
  }
  const transcript = typeof body?.text === "string" ? body.text.trim() : "";
  if (!transcript) return json({ error: "empty text" }, 400, origin);
  if (transcript.length > MAX_TTS_TEXT_LENGTH) return json({ error: "text too long" }, 400, origin);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const cartesiaResponse = await fetch(CARTESIA_TTS_URL, {
      method: "POST",
      headers: {
        "X-API-Key": env.CARTESIA_API_KEY,
        "Cartesia-Version": CARTESIA_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: CARTESIA_TTS_MODEL,
        transcript,
        voice: CARTESIA_VOICE_ID,
        output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 },
        generation_config: { speed: 1, volume: 1 },
      }),
      signal: controller.signal,
    });

    if (!cartesiaResponse.ok) {
      return json({ error: "voice generation failed" }, 502, origin);
    }

    const audio = await cartesiaResponse.arrayBuffer();
    if (!audio.byteLength) return json({ error: "empty voice response" }, 502, origin);
    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
        ...corsHeaders(origin),
      },
    });
  } catch {
    return json({ error: "voice service unavailable" }, 502, origin);
  } finally {
    clearTimeout(timeout);
  }
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const pathname = new URL(request.url).pathname;

    if (pathname === "/status") return handlePublicStatus(request, env);
    if (pathname === "/internal/status") return handleStatusUpdate(request, env);
    if (pathname === "/tts") return handleCartesiaTts(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (!ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "forbidden origin" }, 403, origin);
    }

    if (request.method !== "POST") {
      return json({ error: "method not allowed" }, 405, origin);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (env.CHAT_RATE_LIMITER) {
      const { success } = await env.CHAT_RATE_LIMITER.limit({ key: ip });
      if (!success) {
        return json({ error: "rate limited" }, 429, origin);
      }
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid json" }, 400, origin);
    }

    const message = (body && body.message ? String(body.message) : "").trim();
    if (!message) {
      return json({ error: "empty message" }, 400, origin);
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return json({ error: "message too long" }, 400, origin);
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: "server not configured" }, 500, origin);
    }

    try {
      const geminiResp = await fetch(GEMINI_URL, {
        method: "POST",
        headers: {
          "x-goog-api-key": env.GEMINI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GEMINI_MODEL,
          system_instruction: SYSTEM_PROMPT,
          input: message,
        }),
      });

      if (!geminiResp.ok) {
        const errText = await geminiResp.text();
        console.error("Gemini API error", geminiResp.status, errText.slice(0, 500));
        return json({ error: "upstream error" }, 502, origin);
      }

      const data = await geminiResp.json();
      const reply = (data.output_text || "").trim();
      if (!reply) {
        return json({ error: "empty upstream reply" }, 502, origin);
      }

      return json({ reply }, 200, origin);
    } catch (e) {
      console.error("Worker error", e);
      return json({ error: "internal error" }, 500, origin);
    }
  },
};

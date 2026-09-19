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
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const GEMINI_MODEL = "gemini-3.6-flash";
const MAX_MESSAGE_LENGTH = 500;

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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (origin === ALLOWED_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
  }
  return headers;
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

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (origin !== ALLOWED_ORIGIN) {
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

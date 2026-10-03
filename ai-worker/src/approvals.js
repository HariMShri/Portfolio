/**
 * One-click application approvals from the daily digest email.
 *
 * The job agent signs each Approve / Fill only / Skip link with
 * HMAC-SHA256 over the payload, keyed with the same JOB_STATUS_TOKEN the
 * runner already uses for /internal/status -- so no new secret is needed and
 * nobody without that token can mint an approval.
 *
 *   GET  /approve?t=...   shows a confirmation page. It records nothing,
 *                         because mail scanners open links in emails; a
 *                         prefetch must never count as consent.
 *   POST /approve         (the page's button) records the decision in KV.
 *   GET  /internal/approvals   Bearer JOB_STATUS_TOKEN -- the runner pulls
 *                         recorded decisions into Neon for apply.py.
 *
 * A token carries the job id, scope, a hash of the exact content approved
 * (form URL, resume selection, cover note) and a link expiry. apply.py
 * recomputes that hash before acting, so an approval never covers anything
 * other than what the email showed.
 */

const SCOPES = new Set(["submit", "fill", "skip"]);
const APPROVAL_TTL_MS = 48 * 60 * 60 * 1000; // how long a click stays valid for apply.py
const KV_TTL_SECONDS = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();

function b64urlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function sign(key, payloadB64) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(`approval-v1.${payloadB64}`));
  return b64urlEncode(new Uint8Array(signature));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The verified payload, or null for a bad, tampered or expired token. */
export async function verifyToken(token, key, now = Date.now()) {
  if (typeof token !== "string" || token.length > 2048 || !key) return null;
  const [payloadB64, signature, extra] = token.split(".");
  if (!payloadB64 || !signature || extra !== undefined) return null;
  if (!timingSafeEqual(await sign(key, payloadB64), signature)) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
  } catch {
    return null;
  }
  const valid = payload
    && /^[0-9a-f]{12}$/.test(payload.j || "")
    && SCOPES.has(payload.s)
    && /^[0-9a-f]{64}$/.test(payload.c || "")
    && Number.isFinite(payload.e);
  if (!valid || payload.e * 1000 < now) return null;
  return payload;
}

export async function signToken(payload, key) {
  const payloadB64 = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  return `${payloadB64}.${await sign(key, payloadB64)}`;
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

const SCOPE_TEXT = {
  submit: ["Submit this application for me", "The Applicant will fill the form and submit it, unless a question only you can answer is left."],
  fill: ["Fill the form, I'll press submit", "The Applicant will fill the form and leave it open for you to review and submit."],
  skip: ["Skip this job", "It won't be suggested again."],
};

function page(title, body, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f7f8fb;--card:#fff;--text:#171923;--dim:#5b6072;--accent:#9a6b1f;--line:#e3e6ee}
@media (prefers-color-scheme:dark){:root{--bg:#07090d;--card:#11151b;--text:#eef2f5;--dim:#9fb0bd;--accent:#d8a24a;--line:rgba(214,228,240,.14)}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,sans-serif;padding:16px}
main{max-width:480px;width:100%;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px}
h1{font-size:1.25rem;margin:0 0 8px}p{color:var(--dim);margin:0 0 16px}strong{color:var(--text)}
button{font:inherit;font-weight:600;border:0;border-radius:999px;padding:12px 22px;background:var(--accent);color:#fff;cursor:pointer;width:100%}
</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    },
  });
}

const INVALID = () => page("Link not valid", "<h1>This link isn't valid any more</h1><p>It may have expired. Tomorrow's digest will have fresh links, or run <strong>python apply.py --job-id</strong> on your PC.</p>", 400);

export async function handleApprove(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const token = url.searchParams.get("t") || "";
    const payload = await verifyToken(token, env.JOB_STATUS_TOKEN);
    if (!payload) return INVALID();
    const [action, detail] = SCOPE_TEXT[payload.s];
    return page(action, `<h1>${escapeHtml(action)}?</h1>
<p><strong>${escapeHtml(payload.t)}</strong> at <strong>${escapeHtml(payload.o)}</strong></p>
<p>${escapeHtml(detail)} Nothing happens until you press the button.</p>
<form method="post" action="/approve"><input type="hidden" name="t" value="${escapeHtml(token)}">
<button type="submit">Confirm: ${escapeHtml(action.toLowerCase())}</button></form>`);
  }
  if (request.method !== "POST") return page("Not allowed", "<h1>Not allowed</h1>", 405);
  if (!env.JOB_STATUS) return page("Unavailable", "<h1>Approvals are unavailable right now</h1>", 503);

  let token = "";
  try {
    token = String((await request.formData()).get("t") || "");
  } catch {
    return INVALID();
  }
  const payload = await verifyToken(token, env.JOB_STATUS_TOKEN);
  if (!payload) return INVALID();
  const now = Date.now();
  const record = {
    job_id: payload.j,
    scope: payload.s,
    content_hash: payload.c,
    approved_at: new Date(now).toISOString(),
    expires_at: new Date(now + APPROVAL_TTL_MS).toISOString(),
    approver: "email link",
  };
  await env.JOB_STATUS.put(`approval:${payload.j}`, JSON.stringify(record), { expirationTtl: KV_TTL_SECONDS });
  const done = payload.s === "skip"
    ? "Skipped. It won't be suggested again."
    : "Recorded. Next time you run <strong>python apply.py</strong> on your PC, the Applicant picks this up. The approval is valid for 48 hours.";
  return page("Recorded", `<h1>Done</h1><p>${done}</p>`);
}

export async function handleListApprovals(request, env) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!env.JOB_STATUS || !env.JOB_STATUS_TOKEN) {
    return new Response(JSON.stringify({ error: "approvals unavailable" }), { status: 503, headers });
  }
  if (request.headers.get("Authorization") !== `Bearer ${env.JOB_STATUS_TOKEN}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }
  const approvals = [];
  let cursor;
  do {
    const listing = await env.JOB_STATUS.list({ prefix: "approval:", cursor });
    for (const { name } of listing.keys) {
      const value = await env.JOB_STATUS.get(name, "json");
      if (value) approvals.push(value);
    }
    cursor = listing.list_complete ? undefined : listing.cursor;
  } while (cursor);
  return new Response(JSON.stringify({ approvals }), { status: 200, headers });
}

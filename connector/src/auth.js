/**
 * Sign-in for both doors into the connector, through one GitHub OAuth app,
 * and only for the GitHub account in ALLOWED_GITHUB_LOGIN.
 *
 * - Claude (MCP): /authorize shows a consent page, then GitHub, then
 *   /callback completes the MCP authorization via workers-oauth-provider,
 *   whose helpers bind every step to the browser (CSRF, framing, state).
 * - Dashboard: /dashboard/login goes to GitHub and /callback/dashboard sets a
 *   short-lived signed session cookie.
 *
 * GitHub tokens are used once to learn the login and then discarded.
 */

const encoder = new TextEncoder();
const SESSION_COOKIE = "__Host-career-session";
const DASH_STATE_COOKIE = "__Host-career-dash-state";
const SESSION_HOURS = 12;

export function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlText(text) {
  return b64url(encoder.encode(text));
}

function fromB64urlText(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message))));
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sign(payload, secret) {
  const body = b64urlText(JSON.stringify(payload));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verify(token, secret, now = Date.now()) {
  if (typeof token !== "string" || !secret) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  if (!safeEqual(await hmac(secret, body), signature)) return null;
  try {
    const payload = JSON.parse(fromB64urlText(body));
    return payload.exp && payload.exp * 1000 > now ? payload : null;
  } catch {
    return null;
  }
}

export function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

export function isAllowed(login, env) {
  const allowed = String(env.ALLOWED_GITHUB_LOGIN || "").trim().toLowerCase();
  return Boolean(allowed) && String(login || "").toLowerCase() === allowed;
}

// ---------- GitHub ----------

export async function s256(verifier) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
}

export function githubAuthorizeUrl(env, { redirectUri, state, codeChallenge }) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("allow_signup", "false");
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** Exchange GitHub's code and return the GitHub login; the token is not kept. */
export async function githubLogin(env, { code, redirectUri, verifier }, fetcher = fetch) {
  const tokenResponse = await fetcher("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const { access_token: token } = await tokenResponse.json();
  if (!token) throw new Error("GitHub did not return a token");
  const userResponse = await fetcher("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "shri-hari-career-connector" },
  });
  if (!userResponse.ok) throw new Error("GitHub user lookup failed");
  return (await userResponse.json()).login;
}

// ---------- dashboard session ----------

export async function sessionLogin(request, env) {
  const payload = await verify(readCookie(request, SESSION_COOKIE), env.COOKIE_SECRET);
  return payload && isAllowed(payload.login, env) ? payload.login : null;
}

export async function startDashboardLogin(request, env) {
  const origin = new URL(request.url).origin;
  const state = crypto.randomUUID();
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const binding = await sign({ state, verifier, exp: Math.floor(Date.now() / 1000) + 600 }, env.COOKIE_SECRET);
  const location = githubAuthorizeUrl(env, {
    redirectUri: `${origin}/callback/dashboard`, state, codeChallenge: await s256(verifier),
  });
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Set-Cookie": cookie(DASH_STATE_COOKIE, binding, 600), "Cache-Control": "no-store" },
  });
}

export async function finishDashboardLogin(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  const binding = await verify(readCookie(request, DASH_STATE_COOKIE), env.COOKIE_SECRET);
  if (!binding || !safeEqual(binding.state, url.searchParams.get("state") || "")) {
    return { error: "This sign-in link expired or was opened in another browser. Start again." };
  }
  const login = await githubLogin(env, {
    code: url.searchParams.get("code"), redirectUri: `${url.origin}/callback/dashboard`, verifier: binding.verifier,
  }, fetcher);
  if (!isAllowed(login, env)) return { error: "This dashboard belongs to someone else's account." };
  const session = await sign({ login, exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600 }, env.COOKIE_SECRET);
  return {
    response: new Response(null, {
      status: 302,
      headers: [
        ["Location", "/dashboard"],
        ["Set-Cookie", cookie(SESSION_COOKIE, session, SESSION_HOURS * 3600)],
        ["Set-Cookie", cookie(DASH_STATE_COOKIE, "", 0)],
        ["Cache-Control", "no-store"],
      ],
    }),
  };
}

export function logout() {
  return new Response(null, {
    status: 302, headers: { Location: "/", "Set-Cookie": cookie(SESSION_COOKIE, "", 0), "Cache-Control": "no-store" },
  });
}

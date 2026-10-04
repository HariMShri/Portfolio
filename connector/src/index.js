/**
 * Shri Hari's career connector.
 *
 *   /mcp                 MCP server for Claude (add as a custom connector).
 *                        OAuth 2.1 via workers-oauth-provider; sign-in is
 *                        GitHub, restricted to ALLOWED_GITHUB_LOGIN.
 *   /authorize, /callback  The MCP sign-in: consent page, then GitHub.
 *   /dashboard           Private job pipeline dashboard (GitHub sign-in).
 *
 * Data lives in the job agent's Neon database (DATABASE_URL secret). Nothing
 * here submits an application: decisions are recorded for apply.py.
 */
import { AuthorizationError, CimdFetchError, OAuthProvider, authorizationErrorRedirect } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { neon } from "@neondatabase/serverless";
import * as auth from "./auth.js";
import { dashboardPage, handleDashboardApi, securityHeaders } from "./dashboard.js";
import { createServer } from "./tools.js";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function page(title, body, status = 200, headers = new Headers()) {
  const nonce = crypto.randomUUID();
  for (const [key, value] of Object.entries(securityHeaders(nonce))) if (!headers.has(key)) headers.set(key, value);
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.55 system-ui,sans-serif;background:#07090d;color:#eef2f5;padding:16px}
main{max-width:520px;background:#11151b;border:1px solid rgba(214,228,240,.14);border-radius:14px;padding:28px}
h1{font-size:1.3rem;margin:0 0 10px}p{color:#9fb0bd}strong{color:#eef2f5}a{color:#7fb2c4}
button{font:inherit;font-weight:600;border-radius:999px;padding:10px 20px;border:1px solid #d8a24a;cursor:pointer;margin-right:8px}
.allow{background:#d8a24a;color:#111}.deny{background:transparent;color:#eef2f5}</style></head>
<body><main>${body}</main></body></html>`, { status, headers });
}

// ---------- MCP API (only reached with a valid token from our own OAuth flow) ----------

const mcp = createMcpHandler(() => createServer({
  getSql: () => neon(mcpEnv.DATABASE_URL),
  who: () => getMcpAuthContext()?.props?.login ?? "unknown",
}));
let mcpEnv = {};

const apiHandler = {
  async fetch(request, env, ctx) {
    // Defence in depth: tokens are only ever issued to the allowed login.
    if (!auth.isAllowed(ctx.props?.login, env)) return new Response("Forbidden", { status: 403 });
    mcpEnv = env;
    return mcp(request, env, ctx);
  },
};

// ---------- everything else: sign-in pages and the dashboard ----------

async function authorize(request, env) {
  const oauth = env.OAUTH_PROVIDER;
  if (request.method === "GET") {
    const authRequest = await oauth.parseAuthRequest(request);
    const details = await oauth.describeConsent(authRequest);
    const consent = await oauth.beginConsent(authRequest);
    const origin = details.clientDomain
      ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
      : "This app registered itself; its name is not verified.";
    const loopback = details.redirectIsLoopback
      ? "<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting from it.</p>" : "";
    return page("Connect to your career data", `<h1>Allow ${escape(details.clientName)} to use your career data?</h1>
<p>${origin} Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>${loopback}
<p>It will be able to read your shortlist, packages and insights, and record decisions and outcomes you ask for. It can't submit applications. You'll sign in with GitHub next.</p>
<form method="post"><input type="hidden" name="handle" value="${escape(consent.handle)}">
<button class="allow" name="decision" value="approve">Allow</button><button class="deny" name="decision" value="deny">Deny</button></form>`, 200, consent.headers);
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const form = await request.formData();
  const handle = String(form.get("handle") || "");
  if (form.get("decision") !== "approve") {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const approved = await oauth.approveConsent(request, handle);
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const { state, headers } = await oauth.beginUpstream(approved.request, { data: { verifier }, headers: approved.headers });
  headers.set("Location", auth.githubAuthorizeUrl(env, {
    redirectUri: `${new URL(request.url).origin}/callback`, state, codeChallenge: await auth.s256(verifier),
  }));
  return new Response(null, { status: 302, headers });
}

async function mcpCallback(request, env) {
  const oauth = env.OAUTH_PROVIDER;
  const url = new URL(request.url);
  const { request: original, data, headers } = await oauth.finishUpstream(request);
  if (url.searchParams.get("error")) {
    headers.set("Location", authorizationErrorRedirect(original, "access_denied"));
    return new Response(null, { status: 302, headers });
  }
  const login = await auth.githubLogin(env, {
    code: url.searchParams.get("code"), redirectUri: `${url.origin}/callback`, verifier: data.verifier,
  });
  if (!auth.isAllowed(login, env)) {
    headers.set("Location", authorizationErrorRedirect(original, "access_denied"));
    return new Response(null, { status: 302, headers });
  }
  const { redirectTo } = await oauth.completeAuthorization({
    request: original, userId: login, metadata: {}, scope: original.scope, props: { login },
  });
  headers.set("Location", redirectTo);
  return new Response(null, { status: 302, headers });
}

const defaultHandler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/authorize") return await authorize(request, env);
      if (url.pathname === "/callback") return await mcpCallback(request, env);
      if (url.pathname === "/callback/dashboard") {
        const result = await auth.finishDashboardLogin(request, env);
        return result.response || page("Sign-in failed", `<h1>Sign-in failed</h1><p>${escape(result.error)}</p><p><a href="/dashboard/login">Try again</a></p>`, 403);
      }
      if (url.pathname === "/dashboard/login") return await auth.startDashboardLogin(request, env);
      if (url.pathname === "/logout") return auth.logout();
      if (url.pathname === "/health") {
        // Reports only whether the database answers; no data, no details.
        let database = "unreachable";
        try {
          await neon(env.DATABASE_URL).query("select 1", []);
          database = "ok";
        } catch {
          // fall through
        }
        return new Response(JSON.stringify({ database, sign_in_configured: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.COOKIE_SECRET) }), {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
      if (url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/api/")) {
        const login = await auth.sessionLogin(request, env);
        if (!login) {
          return url.pathname === "/dashboard"
            ? Response.redirect(`${url.origin}/dashboard/login`, 302)
            : new Response(JSON.stringify({ error: "sign in first" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        if (url.pathname === "/dashboard") {
          const nonce = crypto.randomUUID();
          return new Response(dashboardPage(login, nonce), { headers: securityHeaders(nonce) });
        }
        return await handleDashboardApi(request, neon(env.DATABASE_URL), login);
      }
      if (url.pathname === "/") {
        return page("Career connector", `<h1>Shri Hari's career connector</h1>
<p>A private MCP server and dashboard for a personal job-search agent.</p>
<p><a href="/dashboard">Open the dashboard</a> (owner only).</p>
<p>To use it from Claude, add <strong>${escape(url.origin)}/mcp</strong> as a custom connector.</p>`);
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
      if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
        const message = error instanceof AuthorizationError ? error.description : "This app could not be verified.";
        return page("Can't continue", `<h1>Can't continue</h1><p>${escape(message)}</p>`, 400);
      }
      throw error;
    }
  },
};

// The provider needs this Worker's public URL (PUBLIC_URL), which only the
// environment knows, so it's built on the first request and reused.
let provider;
function getProvider(env) {
  if (!provider) {
    const base = String(env.PUBLIC_URL || "").replace(/\/$/, "");
    provider = new OAuthProvider({
      apiRoute: "/mcp",
      apiHandler,
      defaultHandler,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register", // Dynamic Client Registration
      clientIdMetadataDocumentEnabled: true, // and Client ID Metadata Documents
      scopesSupported: ["career:read", "career:write"],
      resourceMetadata: { resource: `${base}/mcp`, authorization_servers: [base] },
    });
  }
  return provider;
}

export default {
  fetch(request, env, ctx) {
    return getProvider(env).fetch(request, env, ctx);
  },
};

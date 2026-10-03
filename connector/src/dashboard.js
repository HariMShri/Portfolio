/**
 * The private job pipeline dashboard: today's shortlist, each job's package
 * (tailored resume, fact-checked cover note, skill gap) and one-click
 * Submit / Fill only / Skip decisions, plus outcome logging and insights.
 *
 * Served only to the signed-in owner. Listing text is untrusted, so the page
 * inserts every value with textContent, never as HTML, under a strict CSP
 * with a per-request script nonce. State-changing calls must be same-origin
 * JSON posts.
 */
import * as data from "./data.js";

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export async function handleDashboardApi(request, sql, login) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/dashboard\/api/, "");
  try {
    if (request.method === "GET") {
      if (path === "/status") return json(await data.pipelineStatus(sql));
      if (path === "/insights") return json(await data.insights(sql));
      if (path === "/shortlist") {
        const filter = url.searchParams.get("filter") || "all";
        return json(await data.shortlist(sql, {
          limit: 100, applyReady: filter === "ready", onlyNew: filter === "new",
          remoteOnly: filter === "remote", undecided: filter === "undecided",
        }));
      }
      const match = path.match(/^\/job\/([0-9a-f]{12})$/);
      if (match) {
        const job = await data.jobDetail(sql, match[1]);
        return job ? json(job) : json({ error: "not found" }, 404);
      }
      return json({ error: "not found" }, 404);
    }
    if (request.method === "POST") {
      // Same-origin JSON only: a cross-site form can't send this content type
      // with our cookie, and the Origin check refuses anything else.
      if (request.headers.get("Origin") !== url.origin || !(request.headers.get("Content-Type") || "").startsWith("application/json")) {
        return json({ error: "forbidden" }, 403);
      }
      const body = await request.json();
      if (!/^[0-9a-f]{12}$/.test(body.job_id || "")) return json({ error: "bad job id" }, 400);
      if (path === "/decide") return json(await data.decide(sql, body.job_id, body.decision, `dashboard (github:${login})`));
      if (path === "/outcome") return json(await data.recordOutcome(sql, body.job_id, body.outcome, body.note));
      return json({ error: "not found" }, 404);
    }
    return json({ error: "method not allowed" }, 405);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "failed" }, 400);
  }
}

export function securityHeaders(nonce) {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": [
      "default-src 'none'", `script-src 'nonce-${nonce}'`, "style-src 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com", "connect-src 'self'", "img-src 'self' data:", "form-action 'self'",
      "frame-ancestors 'none'", "base-uri 'none'",
    ].join("; "),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

const STYLE = `
:root{--bg:#07090d;--panel:#0d1117;--card:#11151b;--line:rgba(214,228,240,.10);--line2:rgba(214,228,240,.2);
--text:#eef2f5;--dim:#9fb0bd;--faint:#6d7f8d;--gold:#d8a24a;--green:#6fae8e;--red:#d4705f;--blue:#7fb2c4;
--serif:'Instrument Serif',Georgia,serif;--mono:'JetBrains Mono',ui-monospace,monospace;--sans:Inter,system-ui,sans-serif}
@media (prefers-color-scheme:light){:root{--bg:#f7f8fb;--panel:#eef0f6;--card:#fff;--line:#e3e6ee;--line2:#cfd4e2;
--text:#171923;--dim:#5b6072;--faint:#8a8fa3;--gold:#9a6b1f;--green:#2f7a52;--red:#b0442f;--blue:#3d6b7d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 var(--sans)}
a{color:var(--blue)}header{display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap;
padding:22px 24px 14px;border-bottom:1px solid var(--line)}h1{font:400 2rem/1 var(--serif);margin:0}
.eyebrow{font:500 .7rem var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--gold)}
.who{font:.75rem var(--mono);color:var(--faint)}.who a{color:var(--dim)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;padding:16px 24px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.stat b{display:block;font:400 1.7rem/1.1 var(--serif)}.stat span{font:.68rem var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
nav{display:flex;gap:6px;flex-wrap:wrap;padding:0 24px 12px}nav button,.actions button,select{font:500 .75rem var(--mono);
letter-spacing:.06em;border:1px solid var(--line2);background:transparent;color:var(--dim);border-radius:999px;padding:7px 13px;cursor:pointer}
nav button[aria-pressed=true]{color:var(--text);border-color:var(--gold)}main{display:grid;grid-template-columns:minmax(300px,420px) 1fr;
gap:16px;padding:0 24px 32px}@media (max-width:860px){main{grid-template-columns:1fr}}
.list{display:flex;flex-direction:column;gap:8px;max-height:calc(100vh - 230px);overflow:auto}
.job{text-align:left;width:100%;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;color:inherit;cursor:pointer;font:inherit}
.job[aria-current=true]{border-color:var(--gold)}.job .t{font-weight:600}.job .c{color:var(--dim);font-size:.85rem}
.tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.tag{font:.62rem var(--mono);letter-spacing:.08em;text-transform:uppercase;
border:1px solid var(--line2);border-radius:999px;padding:2px 8px;color:var(--dim)}.tag.g{color:var(--green);border-color:var(--green)}
.tag.o{color:var(--gold);border-color:var(--gold)}.tag.r{color:var(--red);border-color:var(--red)}
.detail{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;min-height:300px}
.detail h2{font:400 1.6rem/1.15 var(--serif);margin:0 0 4px}.detail h3{font:500 .7rem var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin:20px 0 8px}
.box{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;white-space:pre-wrap}
.warn{color:var(--red)}.ok{color:var(--green)}.muted{color:var(--faint)}ul{margin:6px 0;padding-left:18px}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.actions .primary{background:var(--gold);color:#111;border-color:var(--gold)}
.untrusted{border-left:3px solid var(--line2);padding-left:10px;color:var(--dim);font-size:.9rem;max-height:320px;overflow:auto;white-space:pre-wrap}
.bar{display:grid;grid-template-columns:160px 1fr 50px;gap:10px;align-items:center;font-size:.85rem;margin:4px 0}
.bar i{display:block;height:8px;border-radius:4px;background:var(--gold)}.bar i.miss{background:var(--red)}
.toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--gold);border-radius:999px;padding:8px 16px;font:.8rem var(--mono)}
`;

const SCRIPT = `
const $ = (s, el = document) => el.querySelector(s);
const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); Object.assign(n, props); n.append(...kids.filter(k => k !== null && k !== undefined)); return n; };
const api = async (path, body) => {
  const res = await fetch('/dashboard/api' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const out = await res.json(); if (!res.ok) throw new Error(out.error || 'Request failed'); return out;
};
const toast = (text) => { const t = el('div', { className: 'toast', textContent: text }); document.body.append(t); setTimeout(() => t.remove(), 3200); };
let filter = 'undecided', current = null;

async function loadStatus() {
  const s = await api('/status'); const r = s.latest_run || {};
  const items = [[r.shortlisted ?? 0, 'Shortlisted'], [r.new_jobs ?? 0, 'New today'], [r.remote_jobs ?? 0, 'Remote'],
    [s.awaiting_your_decision, 'Awaiting you'], [s.approvals.waiting_for_apply, 'Ready for apply.py'], [s.outcomes.interview || 0, 'Interviews']];
  $('#stats').replaceChildren(...items.map(([n, label]) => el('div', { className: 'stat' }, el('b', { textContent: n }), el('span', { textContent: label }))));
  $('#run').textContent = r.created_at ? 'Last run ' + new Date(r.created_at).toLocaleString() + ' · ' + (r.discovered ?? 0).toLocaleString() + ' listings read' : 'No runs yet';
}

function tags(job) {
  const t = [];
  if (job.is_new) t.push(['New', 'o']);
  if ((job.work_mode || '').startsWith('remote')) t.push(['Remote', '']);
  if (job.approvable) t.push(['Applicant: ' + job.apply_platform, 'g']); else t.push(['Apply yourself', '']);
  if (job.decision) t.push([job.consumed_at ? job.decision + ' · done' : job.decision, job.decision === 'skip' ? 'r' : 'g']);
  return el('div', { className: 'tags' }, ...t.map(([text, cls]) => el('span', { className: 'tag ' + cls, textContent: text })));
}

async function loadList() {
  const { jobs } = await api('/shortlist?filter=' + filter);
  const list = $('#list');
  if (!jobs.length) { list.replaceChildren(el('p', { className: 'muted', textContent: 'Nothing here.' })); return; }
  list.replaceChildren(...jobs.map(job => {
    const b = el('button', { className: 'job', type: 'button' },
      el('div', { className: 't', textContent: job.title }),
      el('div', { className: 'c', textContent: job.company + ' · ' + (job.location || '') + ' · ' + Math.round(job.match_score) + ' match' }),
      tags(job));
    b.setAttribute('aria-current', String(job.job_id === current));
    b.addEventListener('click', () => openJob(job.job_id));
    return b;
  }));
}

function section(title, ...kids) { return [el('h3', { textContent: title }), ...kids]; }

async function openJob(id) {
  current = id; document.querySelectorAll('.job').forEach(b => b.setAttribute('aria-current', 'false'));
  const job = await api('/job/' + id); const d = $('#detail');
  const parts = [el('div', { className: 'eyebrow', textContent: job.company }), el('h2', { textContent: job.title }),
    el('div', { className: 'muted', textContent: (job.location || '') + ' · ' + Math.round(job.match_score) + ' match · ' + job.source })];
  if (job.url) parts.push(el('p', {}, el('a', { href: job.url, target: '_blank', rel: 'noopener noreferrer', textContent: 'Open the original listing ↗' })));

  const actions = el('div', { className: 'actions' });
  if (job.approvable) {
    for (const [scope, label, primary] of [['submit', 'Submit for me', true], ['fill', "Fill only, I'll submit", false], ['skip', 'Skip', false]]) {
      const b = el('button', { type: 'button', className: primary ? 'primary' : '', textContent: label });
      b.addEventListener('click', async () => {
        try { const r = await api('/decide', { job_id: id, decision: scope });
          toast(scope === 'skip' ? 'Skipped' : 'Approved: run python apply.py within 48h'); await refresh(); openJob(id);
        } catch (e) { toast(e.message); }
      });
      actions.append(b);
    }
  } else actions.append(el('span', { className: 'muted', textContent: 'No form the Applicant can fill: apply on the listing yourself.' }));
  const outcome = el('select', {}, ...['', 'applied', 'interview', 'rejected', 'offer', 'no_response'].map(v => el('option', { value: v, textContent: v ? 'Record: ' + v.replace('_', ' ') : 'Record an outcome…' })));
  outcome.addEventListener('change', async () => { if (!outcome.value) return;
    try { await api('/outcome', { job_id: id, outcome: outcome.value }); toast('Recorded: ' + outcome.value); await refresh(); } catch (e) { toast(e.message); } });
  actions.append(outcome);
  parts.push(...section('Your decision', job.decision ? el('p', { textContent: 'Decided: ' + job.decision + (job.consumed_at ? ' (carried out: ' + job.result + ')' : ' · valid until ' + new Date(job.expires_at).toLocaleString()) }) : null, actions));

  parts.push(...section('Why it matched', el('ul', {}, ...(job.match_reasons || []).map(r => el('li', { textContent: r })))));
  const gap = job.fit_gap || {};
  if ((gap.covered || []).length || (gap.missing || []).length) parts.push(...section('Skills',
    el('p', { className: 'ok', textContent: 'You have: ' + ((gap.covered || []).join(', ') || '–') }),
    el('p', { className: 'warn', textContent: 'They also ask for: ' + ((gap.missing || []).join(', ') || '–') })));

  if (job.cover_note) {
    const review = job.cover_review || {};
    parts.push(...section('Cover note', review.passed ? el('p', { className: 'ok', textContent: '✓ Passed the fact check' })
      : el('p', { className: 'warn', textContent: 'Fact check failed: ' + (review.issues || []).join('; ') }), el('div', { className: 'box', textContent: job.cover_note })));
  }
  if (job.resume) {
    const r = job.resume;
    parts.push(...section('Tailored resume (from your verified profile)', el('div', { className: 'box' },
      el('strong', { textContent: r.name }), el('p', { textContent: r.summary }),
      el('p', { textContent: 'Skills: ' + r.skills.join(' · ') }),
      ...r.experience.map(x => el('div', {}, el('strong', { textContent: x.title + ' — ' + x.company }), el('div', { className: 'muted', textContent: x.dates }),
        el('ul', {}, ...x.highlights.map(h => el('li', { textContent: h }))))))));
  }
  if (job.description) parts.push(...section('Listing text (from the employer\\'s site, shown as-is)', el('div', { className: 'untrusted', textContent: job.description })));
  d.replaceChildren(...parts);
  document.querySelectorAll('.job').forEach(b => { if (b.textContent.startsWith(job.title)) b.setAttribute('aria-current', 'true'); });
}

async function showInsights() {
  current = null; const s = await api('/insights'); const d = $('#detail');
  const max = Math.max(1, ...s.most_requested.map(t => t.jobs));
  d.replaceChildren(el('div', { className: 'eyebrow', textContent: s.listings_seen.toLocaleString() + ' listings across ' + s.runs + ' runs' }),
    el('h2', { textContent: 'What employers ask for' }),
    ...s.most_requested.map(t => { const bar = el('i', { className: t.in_your_profile ? '' : 'miss' }); bar.style.width = Math.round(100 * t.jobs / max) + '%';
      return el('div', { className: 'bar' }, el('span', { textContent: t.term + (t.in_your_profile ? '' : ' (missing)') }), el('span', {}, bar), el('span', { className: 'muted', textContent: t.jobs })); }),
    ...section('Boards that produce matches', el('ul', {}, ...s.productive_boards.map(b => el('li', { textContent: b.board + ': ' + b.shortlisted + ' shortlisted' })))),
    ...section('Parked boards', el('ul', {}, ...(s.parked_boards.length ? s.parked_boards.map(b => el('li', { textContent: b.board + ' (' + b.status + ')' })) : [el('li', { textContent: 'None' })]))));
}

async function refresh() { await Promise.all([loadStatus(), loadList()]); }
document.querySelectorAll('nav [data-filter]').forEach(b => b.addEventListener('click', () => {
  filter = b.dataset.filter; document.querySelectorAll('nav [data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); loadList();
}));
$('#insights').addEventListener('click', showInsights);
refresh().catch(e => toast(e.message));
`;

export function dashboardPage(login, nonce) {
  const safeLogin = String(login).replace(/[^A-Za-z0-9-]/g, "");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Career Pipeline</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=JetBrains+Mono:wght@400;500&family=Inter:wght@400;600&display=swap">
<style>${STYLE}</style></head><body>
<header><div><div class="eyebrow">Shri Hari · private</div><h1>Career pipeline</h1><div class="who" id="run"></div></div>
<div class="who">Signed in as ${safeLogin} · <a href="/logout">Sign out</a></div></header>
<section class="stats" id="stats"></section>
<nav aria-label="Filter jobs">
<button type="button" data-filter="undecided" aria-pressed="true">Awaiting you</button>
<button type="button" data-filter="ready" aria-pressed="false">Applicant can submit</button>
<button type="button" data-filter="new" aria-pressed="false">New</button>
<button type="button" data-filter="remote" aria-pressed="false">Remote</button>
<button type="button" data-filter="all" aria-pressed="false">All</button>
<button type="button" id="insights">Insights</button></nav>
<main><div class="list" id="list"></div><section class="detail" id="detail"><p class="muted">Choose a job to see its package and decide.</p></section></main>
<script nonce="${nonce}">${SCRIPT}</script></body></html>`;
}

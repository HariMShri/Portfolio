/**
 * Queries over the job agent's Neon tables, shared by the MCP tools and the
 * dashboard. Every function takes `sql` -- the Neon serverless client
 * (`neon(DATABASE_URL)`) or a test double -- and only ever calls
 * `sql.query(text, params)` with parameters, never string-built SQL.
 *
 * Listing text (titles, companies, descriptions) comes from employers'
 * websites. It is returned as data and labelled as such; nothing here
 * interprets it.
 */

export const DECISIONS = ["applied", "skipped", "interview", "rejected", "offer", "no_response"];
export const SCOPES = ["submit", "fill", "skip"];
const APPROVAL_HOURS = 48;
const MAX_DESCRIPTION = 4000;

const SHORTLIST_COLUMNS = `
  s.job_id, s.rank, s.match_score, s.match_reasons, s.is_new, s.fit_gap,
  s.apply_platform, s.approval_hash is not null as approvable,
  (s.cover_review->>'passed')::boolean as cover_passed,
  (s.resume_review->>'passed')::boolean as resume_passed,
  j.title, j.company, j.location, j.url, j.source, j.work_mode,
  a.scope as decision, a.approved_at, a.expires_at, a.consumed_at, a.result`;

export async function latestRunId(sql) {
  const rows = await sql.query("select id from runs where shortlisted > 0 order by id desc limit 1", []);
  return rows[0]?.id ?? null;
}

export async function pipelineStatus(sql) {
  const [run] = await sql.query(
    "select id, created_at, discovered, shortlisted, new_jobs, remote_jobs from runs order by id desc limit 1", [],
  );
  const approvals = await sql.query(
    `select
       count(*) filter (where consumed_at is null and expires_at > now() and scope in ('submit','fill'))::int as waiting_for_apply,
       count(*) filter (where scope = 'skip')::int as skipped,
       count(*) filter (where consumed_at is not null)::int as carried_out
     from approvals`, [],
  );
  const outcomes = await sql.query("select decision, count(*)::int as n from outcomes group by decision order by decision", []);
  const awaiting = run ? await sql.query(
    `select count(*)::int as n from shortlist s left join approvals a using (job_id)
     where s.run_id = $1 and s.approval_hash is not null and a.job_id is null`, [run.id],
  ) : [{ n: 0 }];
  return {
    latest_run: run ?? null,
    awaiting_your_decision: awaiting[0].n,
    approvals: approvals[0],
    outcomes: Object.fromEntries(outcomes.map((row) => [row.decision, row.n])),
  };
}

export async function shortlist(sql, { limit = 25, onlyNew = false, applyReady = false, remoteOnly = false, undecided = false } = {}) {
  const runId = await latestRunId(sql);
  if (runId === null) return { run_id: null, jobs: [] };
  const filters = ["s.run_id = $1"];
  if (onlyNew) filters.push("s.is_new");
  if (applyReady) filters.push("s.approval_hash is not null");
  if (remoteOnly) filters.push("j.work_mode like 'remote%'");
  if (undecided) filters.push("a.job_id is null");
  const jobs = await sql.query(
    `select ${SHORTLIST_COLUMNS}
     from shortlist s join jobs j using (job_id) left join approvals a using (job_id)
     where ${filters.join(" and ")} order by s.rank limit $2`,
    [runId, Math.max(1, Math.min(100, Number(limit) || 25))],
  );
  return { run_id: runId, jobs };
}

/** One job with its package. Prefers the newest row that carries a draft. */
export async function jobDetail(sql, jobId) {
  const rows = await sql.query(
    `select ${SHORTLIST_COLUMNS}, s.run_id, s.draft_resume, s.cover_note, s.cover_review, s.qa,
            s.approval_hash, j.description, j.posted_date
     from shortlist s join jobs j using (job_id) left join approvals a using (job_id)
     where s.job_id = $1
     order by (s.draft_resume is not null) desc, s.run_id desc limit 1`,
    [jobId],
  );
  const job = rows[0];
  if (!job) return null;
  if (job.description && job.description.length > MAX_DESCRIPTION) {
    job.description = `${job.description.slice(0, MAX_DESCRIPTION)}…`;
  }
  const profile = await loadMemory(sql, "profile");
  job.resume = renderResume(job.draft_resume, profile);
  return job;
}

/** The tailored resume as plain sections, resolved from profile indices. */
export function renderResume(plan, profile) {
  if (!plan || !profile) return null;
  const experience = (plan.experience || []).map(({ experience_index: index, highlight_indices: picks }) => {
    const entry = (profile.experience || [])[index] || {};
    return {
      title: entry.title || "",
      company: entry.company || "",
      dates: entry.dates || "",
      highlights: (picks || []).map((i) => (entry.highlights || [])[i]).filter(Boolean),
    };
  });
  return { name: profile.name || "", summary: profile.summary || "", skills: plan.skills || [], experience };
}

/**
 * Record your decision on a job. The approval covers exactly the package the
 * daily run stored (its approval_hash); apply.py re-checks that hash before
 * acting, so a decision can't drift onto different content.
 */
export async function decide(sql, jobId, scope, approver, now = new Date()) {
  if (!SCOPES.includes(scope)) throw new Error(`decision must be one of ${SCOPES.join(", ")}`);
  const job = await jobDetail(sql, jobId);
  if (!job) throw new Error("No job with that id.");
  if (!job.approval_hash) {
    throw new Error("This job has no application package the Applicant can submit (no supported form or no passing resume). Apply on the listing yourself.");
  }
  const approvedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + APPROVAL_HOURS * 3600 * 1000).toISOString();
  await sql.query(
    `insert into approvals (job_id, scope, content_hash, approver, approved_at, expires_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (job_id) do update set scope = excluded.scope, content_hash = excluded.content_hash,
       approver = excluded.approver, approved_at = excluded.approved_at, expires_at = excluded.expires_at,
       consumed_at = null, result = null`,
    [jobId, scope, job.approval_hash, approver, approvedAt, expiresAt],
  );
  if (scope === "skip") {
    await recordOutcome(sql, jobId, "skipped", `Skipped by ${approver}`, now);
  }
  return { job_id: jobId, title: job.title, company: job.company, scope, expires_at: expiresAt };
}

export async function recordOutcome(sql, jobId, decision, note = "", now = new Date()) {
  if (!DECISIONS.includes(decision)) throw new Error(`outcome must be one of ${DECISIONS.join(", ")}`);
  const [job] = await sql.query("select title, company from jobs where job_id = $1", [jobId]);
  if (!job) throw new Error("No job with that id.");
  await sql.query(
    `insert into outcomes (job_id, company, title, decision, note, recorded_at)
     values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
    [jobId, job.company, job.title, decision, String(note || "").slice(0, 500), now.toISOString()],
  );
  return { job_id: jobId, decision };
}

export async function loadMemory(sql, name) {
  const rows = await sql.query("select data from memories where name = $1", [name]);
  return rows[0]?.data ?? null;
}

/** What the market asks for, and which job boards actually produce matches. */
export async function insights(sql) {
  const [ats, career, profile] = await Promise.all([
    loadMemory(sql, "ats_memory"), loadMemory(sql, "career_memory"), loadMemory(sql, "profile"),
  ]);
  const terms = Object.entries(ats?.terms || {}).map(([term, record]) => [term, record.jobs || 0]);
  terms.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const owned = new Set((profile?.skills || []).map((skill) => skill.toLowerCase()));
  const sites = Object.entries(career?.sites || {});
  return {
    listings_seen: ats?.jobs_seen ?? 0,
    runs: ats?.runs ?? 0,
    most_requested: terms.slice(0, 15).map(([term, jobs]) => ({ term, jobs, in_your_profile: owned.has(term) })),
    gaps: terms.filter(([term]) => !owned.has(term)).slice(0, 10).map(([term, jobs]) => ({ term, jobs })),
    productive_boards: sites.filter(([, s]) => s.shortlisted_total > 0)
      .sort((a, b) => b[1].shortlisted_total - a[1].shortlisted_total).slice(0, 10)
      .map(([key, s]) => ({ board: key, shortlisted: s.shortlisted_total, listings: s.jobs_total })),
    parked_boards: sites.filter(([, s]) => s.skip_until).map(([key, s]) => ({ board: key, status: s.status, retry_after: s.skip_until })),
  };
}

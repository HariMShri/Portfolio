import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";
import { signToken, verifyToken } from "../src/approvals.js";

const key = "local-test-token";
const base = "https://worker.example";

function makeEnv() {
  const values = new Map();
  return {
    values,
    JOB_STATUS_TOKEN: key,
    JOB_STATUS: {
      async put(name, value) { values.set(name, value); },
      async get(name, type) {
        const value = values.get(name);
        if (value === undefined) return null;
        return type === "json" ? JSON.parse(value) : value;
      },
      async list({ prefix }) {
        return { keys: [...values.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
      },
    },
  };
}

function payload(overrides = {}) {
  return {
    j: "0123456789ab", s: "submit", c: "a".repeat(64),
    e: Math.floor(Date.now() / 1000) + 3600, t: "QA Engineer", o: "Acme", ...overrides,
  };
}

function post(token) {
  const body = new URLSearchParams({ t: token });
  return new Request(`${base}/approve`, {
    method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

test("a signed token verifies; a tampered one does not", async () => {
  const token = await signToken(payload(), key);
  assert.equal((await verifyToken(token, key)).j, "0123456789ab");
  const [body, signature] = token.split(".");
  const forged = await signToken(payload({ s: "submit", j: "ffffffffffff" }), "wrong-key");
  assert.equal(await verifyToken(`${forged.split(".")[0]}.${signature}`, key), null);
  assert.equal(await verifyToken(`${body}.${signature.slice(0, -2)}xx`, key), null);
});

test("expired links and malformed payloads are rejected", async () => {
  assert.equal(await verifyToken(await signToken(payload({ e: 1 }), key), key), null);
  assert.equal(await verifyToken(await signToken(payload({ s: "delete" }), key), key), null);
  assert.equal(await verifyToken(await signToken(payload({ j: "../../x" }), key), key), null);
});

test("opening the link records nothing (mail scanners prefetch links)", async () => {
  const env = makeEnv();
  const token = await signToken(payload(), key);
  const response = await worker.fetch(new Request(`${base}/approve?t=${token}`), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /method="post"/);
  assert.match(html, /QA Engineer/);
  assert.equal(env.values.size, 0);
});

test("pressing the button records the approval with a 48h expiry", async () => {
  const env = makeEnv();
  const response = await worker.fetch(post(await signToken(payload(), key)), env);
  assert.equal(response.status, 200);
  const record = JSON.parse(env.values.get("approval:0123456789ab"));
  assert.equal(record.scope, "submit");
  assert.equal(record.content_hash, "a".repeat(64));
  const hours = (Date.parse(record.expires_at) - Date.parse(record.approved_at)) / 3600000;
  assert.equal(hours, 48);
});

test("a forged POST records nothing", async () => {
  const env = makeEnv();
  const response = await worker.fetch(post(await signToken(payload(), "attacker-key")), env);
  assert.equal(response.status, 400);
  assert.equal(env.values.size, 0);
});

test("titles are escaped on the confirmation page", async () => {
  const token = await signToken(payload({ t: "<script>alert(1)</script>" }), key);
  const html = await (await worker.fetch(new Request(`${base}/approve?t=${token}`), makeEnv())).text();
  assert.doesNotMatch(html, /<script>alert/);
});

test("listing approvals needs the runner token", async () => {
  const env = makeEnv();
  await worker.fetch(post(await signToken(payload(), key)), env);
  const denied = await worker.fetch(new Request(`${base}/internal/approvals`), env);
  assert.equal(denied.status, 401);
  const allowed = await worker.fetch(new Request(`${base}/internal/approvals`, {
    headers: { Authorization: `Bearer ${key}` },
  }), env);
  const { approvals } = await allowed.json();
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].job_id, "0123456789ab");
});

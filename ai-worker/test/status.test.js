import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

const token = "local-test-token";

function makePayload() {
  const ids = [
    "role-scout",
    "fit-analyst",
    "resume-tailor",
    "application-writer",
    "application-reviewer",
    "application-coordinator",
    "feedback-analyst",
  ];
  return {
    schema_version: 1,
    run_status: "running",
    counts: {
      discovered: 4,
      shortlisted: 2,
      drafted: 1,
      resumes_tailored: 1,
      awaiting_review: 1,
      applied: 0,
      skipped: 0,
    },
    agents: ids.map((id) => ({ id, status: id === "role-scout" ? "completed" : "planned" })),
  };
}

function makeEnv() {
  const values = new Map();
  return {
    JOB_STATUS_TOKEN: token,
    JOB_STATUS: {
      async put(key, value) { values.set(key, JSON.parse(value)); },
      async get(key) { return values.get(key) || null; },
    },
  };
}

function updateRequest(payload, authorization = `Bearer ${token}`) {
  return new Request("https://worker.test/internal/status", {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("rejects status writes without the worker token", async () => {
  const response = await worker.fetch(updateRequest(makePayload(), "Bearer wrong"), makeEnv());
  assert.equal(response.status, 401);
});

test("rejects malformed aggregate contracts", async () => {
  const payload = makePayload();
  payload.agents.pop();
  const response = await worker.fetch(updateRequest(payload), makeEnv());
  assert.equal(response.status, 400);
});

test("stores and exposes only the allowlisted aggregate fields", async () => {
  const env = makeEnv();
  const payload = { ...makePayload(), job_description: "private", resume: "private", arbitrary: "secret" };
  const writeResponse = await worker.fetch(updateRequest(payload), env);
  assert.equal(writeResponse.status, 200);

  const readResponse = await worker.fetch(new Request("https://worker.test/status"), env);
  assert.equal(readResponse.status, 200);
  const status = await readResponse.json();
  assert.deepEqual(
    Object.keys(status).sort(),
    ["agents", "counts", "run_status", "runtime", "schema_version", "updated_at"],
  );
  assert.equal(status.counts.discovered, 4);
  assert.equal("job_description" in status, false);
  assert.equal("resume" in status, false);
  assert.equal("arbitrary" in status, false);
});

test("accepts and exposes the local model runtime state", async () => {
  const env = makeEnv();
  const payload = { ...makePayload(), runtime: { model: "llama3.2:3b", status: "running" } };
  assert.equal((await worker.fetch(updateRequest(payload), env)).status, 200);

  const status = await (await worker.fetch(new Request("https://worker.test/status"), env)).json();
  assert.deepEqual(status.runtime, { model: "llama3.2:3b", status: "running" });
});

test("defaults the runtime state when a runner does not report one", async () => {
  const env = makeEnv();
  assert.equal((await worker.fetch(updateRequest(makePayload()), env)).status, 200);

  const status = await (await worker.fetch(new Request("https://worker.test/status"), env)).json();
  assert.deepEqual(status.runtime, { model: "", status: "idle" });
});

test("rejects an invalid or oversized runtime block", async () => {
  const env = makeEnv();
  const badStatus = { ...makePayload(), runtime: { model: "llama3.2:3b", status: "melting" } };
  const badName = { ...makePayload(), runtime: { model: "x".repeat(65), status: "idle" } };
  const injected = { ...makePayload(), runtime: { model: "<script>alert(1)</script>", status: "idle" } };

  assert.equal((await worker.fetch(updateRequest(badStatus), env)).status, 400);
  assert.equal((await worker.fetch(updateRequest(badName), env)).status, 400);
  assert.equal((await worker.fetch(updateRequest(injected), env)).status, 400);
});

test("reports unavailable when no status store is configured", async () => {
  const response = await worker.fetch(new Request("https://worker.test/status"), {});
  assert.equal(response.status, 503);
});

test("reports waiting when the configured status store has no published snapshot", async () => {
  const response = await worker.fetch(new Request("https://worker.test/status"), {
    JOB_STATUS: { async get() { return null; } },
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "status not yet published");
});

test("allows exact localhost origins for development status reads", async () => {
  const response = await worker.fetch(new Request("https://worker.test/status", {
    headers: { Origin: "http://127.0.0.1:8000" },
  }), {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:8000");
});

test("does not allow unrelated origins", async () => {
  const response = await worker.fetch(new Request("https://worker.test/status", {
    headers: { Origin: "https://untrusted.example" },
  }), {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("rejects Cartesia TTS requests from unapproved origins", async () => {
  const response = await worker.fetch(new Request("https://worker.test/tts", {
    method: "POST",
    headers: { Origin: "https://attacker.invalid", "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Hello" }),
  }), { CARTESIA_API_KEY: "test-key" });
  assert.equal(response.status, 403);
});

test("rejects invalid and oversized Cartesia TTS text", async () => {
  const env = { CARTESIA_API_KEY: "test-key" };
  const headers = { Origin: "https://harimshri.github.io", "Content-Type": "application/json" };
  const empty = await worker.fetch(new Request("https://worker.test/tts", {
    method: "POST", headers, body: JSON.stringify({ text: "  " }),
  }), env);
  const long = await worker.fetch(new Request("https://worker.test/tts", {
    method: "POST", headers, body: JSON.stringify({ text: "x".repeat(1201) }),
  }), env);
  assert.equal(empty.status, 400);
  assert.equal(long.status, 400);
});

test("forwards text and private credentials to the configured Cartesia voice", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamRequest;
  globalThis.fetch = async (url, options) => {
    upstreamRequest = { url, options };
    return new Response(new Uint8Array([73, 68, 51, 4]), {
      status: 200,
      headers: { "Content-Type": "audio/wav" },
    });
  };

  try {
    const response = await worker.fetch(new Request("https://worker.test/tts", {
      method: "POST",
      headers: { Origin: "https://harimshri.github.io", "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello from my portfolio." }),
    }), { CARTESIA_API_KEY: "private-test-key" });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "audio/wav");
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [73, 68, 51, 4]);
    assert.equal(upstreamRequest.url, "https://api.cartesia.ai/tts/bytes");
    assert.equal(upstreamRequest.options.headers["X-API-Key"], "private-test-key");
    assert.equal(upstreamRequest.options.headers["Cartesia-Version"], "2026-08-14");
    const payload = JSON.parse(upstreamRequest.options.body);
    assert.equal(payload.model_id, "sonic-3.6");
    assert.equal(payload.transcript, "Hello from my portfolio.");
    assert.equal(payload.voice, "99b5248d-caa2-47e3-ae22-9e6567ce4123");
    assert.deepEqual(payload.output_format, {
      container: "wav",
      encoding: "pcm_s16le",
      sample_rate: 44100,
    });
    assert.deepEqual(payload.generation_config, { speed: 1, volume: 1 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns unavailable when Cartesia is not configured", async () => {
  const response = await worker.fetch(new Request("https://worker.test/tts", {
    method: "POST",
    headers: { Origin: "https://harimshri.github.io", "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Hello" }),
  }), {});
  assert.equal(response.status, 503);
});
"""Local model client (Ollama) for the one step that genuinely needs
generation: the cover note and application answers.

There is no API key, no quota and no per-call cost here, so the failure
modes are different from a hosted API: the server may still be loading, the
first call pays a cold model load, and generation on a CPU runner is slow
but free. Retries are therefore about readiness and malformed output, not
rate limits.

Contract (verified against Ollama's API docs): POST /api/generate with
`stream: false` returns the generated text in the top-level `response`
field, and `format` accepts a JSON schema to constrain the output.
"""
import json
import os
import time
from typing import Optional

import requests

DEFAULT_HOST = "http://127.0.0.1:11434"
READY_TIMEOUT_SECONDS = 180
GENERATE_TIMEOUT_SECONDS = 600
MAX_JSON_RETRIES = 1


def host() -> str:
    return os.environ.get("OLLAMA_HOST", DEFAULT_HOST).rstrip("/")


def wait_until_ready(timeout: int = READY_TIMEOUT_SECONDS, label: str = "local-llm") -> bool:
    """Block until the model server answers, so a cold start in CI is a wait
    rather than a failed run."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            response = requests.get(f"{host()}/api/tags", timeout=5)
            if response.ok:
                return True
        except requests.RequestException:
            pass
        time.sleep(3)
    print(f"  [{label}] local model server did not become ready within {timeout}s")
    return False


def available_models() -> list:
    try:
        response = requests.get(f"{host()}/api/tags", timeout=10)
        response.raise_for_status()
        return [entry.get("name", "") for entry in response.json().get("models", [])]
    except (requests.RequestException, ValueError):
        return []


def _extract_text(payload: object) -> str:
    """Generated text lives in `response` for /api/generate; `message.content`
    is accepted too so a future switch to /api/chat does not break parsing."""
    if not isinstance(payload, dict):
        return ""
    direct = payload.get("response")
    if isinstance(direct, str) and direct.strip():
        return direct
    message = payload.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str):
            return content
    return ""


def _shape_summary(payload: object, text: str) -> str:
    if not isinstance(payload, dict):
        return f"response was {type(payload).__name__}, not an object"
    keys = ",".join(sorted(payload.keys())[:8]) or "none"
    return f"done={payload.get('done', 'absent')} keys={keys} text_chars={len(text)}"


def generate_json(
    prompt: str,
    system_prompt: str,
    model: str,
    label: str,
    schema: Optional[dict] = None,
    temperature: float = 0.4,
) -> tuple[Optional[dict], Optional[str]]:
    """Ask the local model for a JSON object. Returns (parsed, None) or
    (None, safe_error_message)."""
    body = {
        "model": model,
        "prompt": prompt,
        "system": system_prompt,
        "stream": False,
        "options": {"temperature": temperature, "num_predict": 900},
    }
    if schema is not None:
        body["format"] = schema

    for attempt in range(MAX_JSON_RETRIES + 1):
        try:
            response = requests.post(f"{host()}/api/generate", json=body, timeout=GENERATE_TIMEOUT_SECONDS)
            response.raise_for_status()
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else "unknown"
            print(f"  [{label}] local model returned HTTP {status}")
            return None, f"Local model returned HTTP {status}; check the model name and server log."
        except requests.RequestException as exc:
            print(f"  [{label}] local model request failed ({type(exc).__name__})")
            return None, "Local model server was unreachable; check that it is running."

        try:
            payload = response.json()
        except ValueError:
            print(f"  [{label}] local model response body was not JSON")
            return None, "Local model returned a non-JSON response body."

        text = _extract_text(payload).strip()
        if not text:
            print(f"  [{label}] local model returned no text ({_shape_summary(payload, text)})")
            return None, "Local model returned no output text."

        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()

        try:
            return json.loads(text), None
        except json.JSONDecodeError:
            if attempt < MAX_JSON_RETRIES:
                print(f"  [{label}] local model returned invalid JSON; retrying once")
                continue
            print(f"  [{label}] local model returned invalid JSON ({_shape_summary(payload, text)})")
            return None, "Local model returned invalid JSON."
    return None, "Local model returned invalid JSON."

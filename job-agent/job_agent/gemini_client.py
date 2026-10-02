"""Shared Gemini REST call helper used by every agent that talks to Gemini
(Resume Tailor, Application Writer).

Centralizing this gives the whole run one consistent failure-handling
policy instead of each caller inventing its own:

- Transient server errors (500/502/503/504) and network/timeout errors
  retry a bounded number of times with exponential backoff + jitter.
- A 429 gets one short backoff-and-retry if the server told us how long to
  wait (Retry-After) and that wait is short; otherwise the whole run's
  remaining Gemini calls are paused via ``run_state.rate_limited`` so later
  jobs fail fast instead of each burning a call against an exhausted quota.
- A response that carried text but wasn't valid JSON gets one same-prompt
  retry (model output is stochastic) before the job is marked failed on
  its own, without blocking the rest of the shortlist. A response that
  carried *no* text is not retried: that is a structural problem, and
  re-asking just burns quota.
- Requests are spaced a few seconds apart, because the per-minute free
  tier quota -- not the per-day one -- is what a single run actually hits.

The Interactions API returns generated text in ``steps[].content[].text``.
``output_text`` is an SDK convenience property and is NOT present in the
raw REST payload; reading it was why every draft silently failed to parse.

Every failure path returns a safe, user-facing message -- never the raw
response body or the API key -- so callers can log/store it directly.
"""
import json
import random
import time
from typing import Optional

import requests

from .models import GeminiRunState

API_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"

TRANSIENT_STATUS_CODES = {500, 502, 503, 504}
MAX_TRANSIENT_RETRIES = 2
MAX_JSON_REPAIR_RETRIES = 1
BASE_BACKOFF_SECONDS = 1.5
MAX_RATE_LIMIT_WAIT_SECONDS = 20
MIN_CALL_INTERVAL_SECONDS = 4.0

_last_call_at = 0.0


def _sleep_with_backoff(attempt: int) -> None:
    delay = BASE_BACKOFF_SECONDS * (2 ** attempt) + random.uniform(0, 0.75)
    time.sleep(delay)


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    return text.strip()


def _extract_text(payload: object) -> str:
    """Pull the generated text out of an Interactions response.

    Text lives in ``steps[].content[].text``; the last model_output step
    wins, falling back to every text block in order. ``output_text`` is
    checked first only because SDK-shaped payloads may carry it.
    """
    if not isinstance(payload, dict):
        return ""
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct

    steps = payload.get("steps")
    if not isinstance(steps, list):
        return ""

    def step_text(step: object) -> str:
        if not isinstance(step, dict):
            return ""
        content = step.get("content")
        if not isinstance(content, list):
            return ""
        return "".join(
            item["text"] for item in content
            if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str)
        )

    for step in reversed(steps):
        if isinstance(step, dict) and step.get("type") == "model_output":
            text = step_text(step)
            if text.strip():
                return text
    return "".join(step_text(step) for step in steps)


def _shape_summary(payload: object, text: str) -> str:
    """Safe-to-log description of a response: structure only, never content."""
    if not isinstance(payload, dict):
        return f"response was {type(payload).__name__}, not an object"
    keys = ",".join(sorted(payload.keys())[:8]) or "none"
    return f"status={payload.get('status', 'absent')} keys={keys} text_chars={len(text)}"


def _parse_retry_after(response) -> Optional[float]:
    if response is None:
        return None
    try:
        value = response.headers.get("Retry-After")
        return max(0.0, float(value)) if value else None
    except (TypeError, ValueError, AttributeError):
        return None


def _post(prompt: str, system_prompt: str, api_key: str, model: str, schema: Optional[dict]) -> requests.Response:
    global _last_call_at
    wait = MIN_CALL_INTERVAL_SECONDS - (time.monotonic() - _last_call_at)
    if _last_call_at and wait > 0:
        time.sleep(wait)
    _last_call_at = time.monotonic()

    body = {"model": model, "system_instruction": system_prompt, "input": prompt}
    if schema is not None:
        body["response_format"] = {"type": "text", "mime_type": "application/json", "schema": schema}
    return requests.post(
        API_URL,
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json=body,
        timeout=60,
    )


def gemini_json_request(
    prompt: str,
    system_prompt: str,
    api_key: str,
    model: str,
    run_state: Optional[GeminiRunState],
    label: str,
    schema: Optional[dict] = None,
) -> tuple[Optional[dict], Optional[str]]:
    """Call Gemini and parse a JSON object from its output.

    Returns ``(parsed_dict, None)`` on success or ``(None, error_message)``
    on failure. ``label`` tags log lines with the calling agent (e.g.
    "resume-tailor", "drafter").
    """
    attempt = 0
    json_attempts = 0
    active_schema = schema
    while True:
        try:
            response = _post(prompt, system_prompt, api_key, model, active_schema)
            response.raise_for_status()
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status in (400, 404) and active_schema is not None:
                # The structured-output field is the only optional part of the
                # request, so if the service rejects the body, drop it and let
                # the prompt's own "return only JSON" instruction carry the
                # call rather than failing the job outright.
                print(f"  [{label}] Gemini rejected the response_format field (HTTP {status}); retrying without it")
                active_schema = None
                attempt += 1
                continue
            if status == 429:
                retry_after = _parse_retry_after(exc.response)
                if attempt == 0 and retry_after is not None and retry_after <= MAX_RATE_LIMIT_WAIT_SECONDS:
                    print(f"  [{label}] Gemini rate-limited (HTTP 429); waiting {retry_after:.0f}s and retrying once")
                    time.sleep(retry_after)
                    attempt += 1
                    continue
                print(f"  [{label}] Gemini request failed (HTTP {status})")
                if run_state is not None:
                    run_state.rate_limited = True
                return None, "Gemini returned HTTP 429 (rate limited)."
            if status in TRANSIENT_STATUS_CODES and attempt < MAX_TRANSIENT_RETRIES:
                print(f"  [{label}] Gemini request failed (HTTP {status}); retrying ({attempt + 1}/{MAX_TRANSIENT_RETRIES})")
                _sleep_with_backoff(attempt)
                attempt += 1
                continue
            print(f"  [{label}] Gemini request failed (HTTP {status})")
            return None, f"Gemini returned HTTP {status}; check the Actions log and model/API access."
        except requests.RequestException as exc:
            if attempt < MAX_TRANSIENT_RETRIES:
                print(f"  [{label}] Gemini request error ({type(exc).__name__}); retrying ({attempt + 1}/{MAX_TRANSIENT_RETRIES})")
                _sleep_with_backoff(attempt)
                attempt += 1
                continue
            print(f"  [{label}] Gemini request failed ({type(exc).__name__})")
            return None, "Gemini request failed; retry or review network/API access."

        try:
            payload = response.json()
        except ValueError:
            print(f"  [{label}] Gemini response body was not JSON at all")
            return None, "Gemini returned a non-JSON response body."

        raw = _extract_text(payload)
        text = _strip_code_fence(raw)
        if not text:
            # No text to parse: a structural problem (unexpected payload shape,
            # blocked or failed interaction). Re-asking would only burn quota.
            print(f"  [{label}] Gemini response carried no output text ({_shape_summary(payload, raw)})")
            return None, "Gemini returned no output text; check the response shape in the run log."

        try:
            return json.loads(text), None
        except json.JSONDecodeError:
            if json_attempts < MAX_JSON_REPAIR_RETRIES:
                print(f"  [{label}] Gemini returned a response that was not valid JSON; retrying once")
                json_attempts += 1
                attempt += 1
                continue
            print(f"  [{label}] Gemini returned a response that was not valid JSON ({_shape_summary(payload, raw)})")
            return None, "Gemini returned invalid JSON; review the model response format."

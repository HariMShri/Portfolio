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
- A response that isn't valid JSON gets one same-prompt retry (Gemini
  output is stochastic; a clean retry is simpler and more reliable than
  trying to programmatically repair malformed JSON) before the job is
  marked failed on its own, without blocking the rest of the shortlist.

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


def _parse_retry_after(response) -> Optional[float]:
    if response is None:
        return None
    try:
        value = response.headers.get("Retry-After")
        return max(0.0, float(value)) if value else None
    except (TypeError, ValueError, AttributeError):
        return None


def _post(prompt: str, system_prompt: str, api_key: str, model: str) -> requests.Response:
    return requests.post(
        API_URL,
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json={"model": model, "system_instruction": system_prompt, "input": prompt},
        timeout=60,
    )


def gemini_json_request(
    prompt: str,
    system_prompt: str,
    api_key: str,
    model: str,
    run_state: Optional[GeminiRunState],
    label: str,
) -> tuple[Optional[dict], Optional[str]]:
    """Call Gemini and parse a JSON object from its output.

    Returns ``(parsed_dict, None)`` on success or ``(None, error_message)``
    on failure. ``label`` tags log lines with the calling agent (e.g.
    "resume-tailor", "drafter").
    """
    attempt = 0
    json_attempts = 0
    while True:
        try:
            response = _post(prompt, system_prompt, api_key, model)
            response.raise_for_status()
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
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

        text = _strip_code_fence(response.json().get("output_text", ""))
        try:
            return json.loads(text), None
        except json.JSONDecodeError:
            if json_attempts < MAX_JSON_REPAIR_RETRIES:
                print(f"  [{label}] Gemini returned a response that was not valid JSON; retrying once")
                json_attempts += 1
                attempt += 1
                continue
            print(f"  [{label}] Gemini returned a response that was not valid JSON")
            return None, "Gemini returned invalid JSON; review the model response format."

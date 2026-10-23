import json
import os
from urllib import error, request


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "openai/gpt-oss-120b"
AI_RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "reply": {"type": "string"},
        "actions": {
            "type": "array",
            "items": {
                "oneOf": [
                    {"type": "object", "additionalProperties": False, "properties": {"action": {"const": "create"}, "title": {"type": "string"}, "details": {"type": "string"}, "column_id": {"type": "integer"}, "position": {"type": ["integer", "null"]}}, "required": ["action", "title", "details", "column_id", "position"]},
                    {"type": "object", "additionalProperties": False, "properties": {"action": {"const": "edit"}, "card_id": {"type": "integer"}, "title": {"type": "string"}, "details": {"type": "string"}}, "required": ["action", "card_id", "title", "details"]},
                    {"type": "object", "additionalProperties": False, "properties": {"action": {"const": "move"}, "card_id": {"type": "integer"}, "column_id": {"type": "integer"}, "position": {"type": "integer"}}, "required": ["action", "card_id", "column_id", "position"]}
                ]
            }
        }
    },
    "required": ["reply", "actions"]
}


class OpenRouterError(RuntimeError):
    """Raised when OpenRouter cannot provide a usable completion."""


def check_connectivity() -> str:
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise OpenRouterError("not_configured")

    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": "2+2"}],
    }
    http_request = request.Request(
        OPENROUTER_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with request.urlopen(http_request, timeout=20) as response:
            result = json.loads(response.read())
    except (error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        raise OpenRouterError("provider_error") from exc

    try:
        answer = result["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise OpenRouterError("provider_error") from exc
    if not isinstance(answer, str) or not answer.strip():
        raise OpenRouterError("provider_error")
    return answer.strip()


def request_board_actions(board: dict, message: str, history: list[dict[str, str]]) -> dict:
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise OpenRouterError("not_configured")
    messages = [
        {"role": "system", "content": "You manage a project board. Return only the requested structured response. Use numeric IDs from the board. Never invent card or column IDs. Only include actions when the user explicitly asks to create, edit, or move cards; for questions, summaries, or read-only requests, actions must be an empty array."},
        {"role": "system", "content": "Current board JSON:\n" + json.dumps(board, separators=(",", ":"))},
        *history,
        {"role": "user", "content": message},
    ]
    payload = {
        "model": MODEL,
        "messages": messages,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "board_actions", "strict": True, "schema": AI_RESPONSE_SCHEMA},
        },
    }
    http_request = request.Request(
        OPENROUTER_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(http_request, timeout=30) as response:
            result = json.loads(response.read())
        content = result["choices"][0]["message"]["content"]
        return json.loads(content)
    except (error.URLError, TimeoutError, OSError, json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
        raise OpenRouterError("provider_error") from exc

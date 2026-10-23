import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app import openrouter
from app import main as main_module
from app.main import SESSION_COOKIE, create_app


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    (tmp_path / "index.html").write_text("<h1>Loading session</h1>")
    assets = tmp_path / "_next" / "static"
    assets.mkdir(parents=True)
    (assets / "app.js").write_text("console.log('board')")
    return TestClient(create_app(tmp_path, tmp_path / "board.sqlite3"))


def sign_in(client: TestClient) -> str:
    response = client.post("/api/login", json={"username": "user", "password": "password"})
    assert response.status_code == 200
    return client.cookies[SESSION_COOKIE]


def test_frontend_and_api_routes(client: TestClient) -> None:

    response = client.get("/")
    assert response.status_code == 200
    assert "Loading session" in response.text
    assert "Backlog" not in response.text

    asset = client.get("/_next/static/app.js")
    assert asset.status_code == 200
    assert "board" in asset.text

    response = client.get("/api/hello")
    assert response.status_code == 401
    sign_in(client)
    response = client.get("/api/hello")
    assert response.status_code == 200
    assert response.json() == {"message": "Hello from FastAPI"}


@pytest.mark.parametrize("username,password", [("bad", "password"), ("user", "bad")])
def test_invalid_login(client: TestClient, username: str, password: str) -> None:
    response = client.post("/api/login", json={"username": username, "password": password})
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid credentials"}
    assert SESSION_COOKIE not in client.cookies
    assert "password" not in response.text


def test_non_ascii_credentials_are_rejected_not_crashed(client: TestClient) -> None:
    for username, password in [("usér", "password"), ("user", "pässword")]:
        response = client.post("/api/login", json={"username": username, "password": password})
        assert response.status_code == 401


def test_oversized_ids_and_text_are_rejected(client: TestClient) -> None:
    sign_in(client)
    huge = 2**63
    assert client.patch(f"/api/cards/{huge}", json={"title": "a", "details": ""}).status_code == 422
    assert client.delete(f"/api/cards/{huge}").status_code == 422
    assert client.patch(f"/api/columns/{huge}", json={"title": "a"}).status_code == 422
    assert client.post("/api/cards", json={"title": "a", "column_id": huge}).status_code == 422
    assert client.post("/api/cards/1/move", json={"column_id": 1, "position": huge}).status_code == 422
    assert client.post("/api/cards", json={"title": "a" * 201, "column_id": 1}).status_code == 422
    assert client.post("/api/cards", json={"title": "a", "details": "d" * 5001, "column_id": 1}).status_code == 422
    assert client.post("/api/ai/chat", json={"message": "m" * 4001}).status_code == 422
    history = [{"role": "user", "content": "hi"}] * 51
    assert client.post("/api/ai/chat", json={"message": "hi", "history": history}).status_code == 422


def test_login_session_and_logout(client: TestClient) -> None:
    assert client.get("/api/session").json() == {"authenticated": False}
    cookie = client.post("/api/login", json={"username": "user", "password": "password"})
    assert cookie.status_code == 200
    token = client.cookies[SESSION_COOKIE]
    assert "httponly" in cookie.headers["set-cookie"].lower()
    assert "samesite=strict" in cookie.headers["set-cookie"].lower()
    assert client.get("/api/session").json() == {"authenticated": True}
    assert client.post("/api/logout").json() == {"authenticated": False}
    assert client.get("/api/session").json() == {"authenticated": False}
    client.cookies.set(SESSION_COOKIE, token)
    assert client.get("/api/hello").status_code == 401


def test_expired_session_is_rejected(client: TestClient) -> None:
    token = sign_in(client)
    user_id, _ = client.app.state.sessions[token]
    client.app.state.sessions[token] = (user_id, 0)
    assert client.get("/api/session").json() == {"authenticated": False}
    assert client.get("/api/hello").status_code == 401
    assert token not in client.app.state.sessions


class FakeResponse:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.payload


def test_ai_check_builds_openrouter_request_and_returns_answer(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sign_in(client)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    captured: dict[str, object] = {}

    def fake_urlopen(http_request: object, timeout: int) -> FakeResponse:
        captured["request"] = http_request
        captured["timeout"] = timeout
        return FakeResponse(b'{"choices":[{"message":{"content":"4"}}]}')

    monkeypatch.setattr(openrouter.request, "urlopen", fake_urlopen)
    response = client.post("/api/ai/check")

    assert response.status_code == 200
    assert response.json() == {"answer": "4"}
    http_request = captured["request"]
    assert http_request.full_url == openrouter.OPENROUTER_URL
    assert http_request.method == "POST"
    assert http_request.headers["Authorization"] == "Bearer test-key"
    assert http_request.headers["Content-type"] == "application/json"
    assert http_request.data == b'{"model": "openai/gpt-oss-120b", "messages": [{"role": "user", "content": "2+2"}]}'
    assert captured["timeout"] == 20


def test_ai_check_rejects_missing_key_without_calling_provider(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sign_in(client)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    called = False

    def fake_urlopen(http_request: object, timeout: int) -> FakeResponse:
        nonlocal called
        called = True
        return FakeResponse(b"{}")

    monkeypatch.setattr(openrouter.request, "urlopen", fake_urlopen)
    response = client.post("/api/ai/check")

    assert response.status_code == 503
    assert response.json() == {"detail": "OpenRouter is not configured"}
    assert not called


def test_ai_check_hides_provider_failures(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    sign_in(client)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    def fake_urlopen(http_request: object, timeout: int) -> FakeResponse:
        raise OSError("provider detail must not escape")

    monkeypatch.setattr(openrouter.request, "urlopen", fake_urlopen)
    response = client.post("/api/ai/check")

    assert response.status_code == 502
    assert response.json() == {"detail": "OpenRouter request failed"}


def test_ai_chat_sends_board_and_history_and_reply_only_changes_nothing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sign_in(client)
    before = client.get("/api/board").json()
    captured: dict[str, object] = {}

    def fake_request(board: dict, message: str, history: list[dict[str, str]]) -> dict:
        captured.update(board=board, message=message, history=history)
        return {"reply": "No changes needed.", "actions": []}

    monkeypatch.setattr(main_module, "request_board_actions", fake_request)
    response = client.post(
        "/api/ai/chat",
        json={"message": "Summarize the board", "history": [{"role": "user", "content": "Hi"}]},
    )

    assert response.status_code == 200
    assert response.json() == {"reply": "No changes needed.", "actions": []}
    assert captured["board"] == before
    assert captured["message"] == "Summarize the board"
    assert captured["history"] == [{"role": "user", "content": "Hi"}]
    assert client.get("/api/board").json() == before


def test_openrouter_board_request_contains_board_message_history_and_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    captured: dict[str, object] = {}

    def fake_urlopen(http_request: object, timeout: int) -> FakeResponse:
        captured["body"] = http_request.data
        captured["timeout"] = timeout
        return FakeResponse(b'{"choices":[{"message":{"content":"{\\"reply\\":\\"Done\\",\\"actions\\":[]}"}}]}')

    monkeypatch.setattr(openrouter.request, "urlopen", fake_urlopen)
    result = openrouter.request_board_actions(
        {"id": 1, "columns": []},
        "Summarize",
        [{"role": "user", "content": "Earlier"}],
    )

    body = json.loads(captured["body"])
    assert result == {"reply": "Done", "actions": []}
    assert body["model"] == "openai/gpt-oss-120b"
    assert body["messages"][-2:] == [
        {"role": "user", "content": "Earlier"},
        {"role": "user", "content": "Summarize"},
    ]
    assert body["messages"][1]["content"] == 'Current board JSON:\n{"id":1,"columns":[]}'
    assert body["response_format"]["type"] == "json_schema"


def test_ai_chat_applies_multiple_ordered_actions_transactionally(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sign_in(client)
    initial = client.get("/api/board").json()
    backlog, discovery = [column["id"] for column in initial["columns"]][:2]
    first = client.post("/api/cards", json={"column_id": backlog, "title": "First"}).json()
    first_id = first["columns"][0]["cards"][0]["id"]
    second = client.post("/api/cards", json={"column_id": backlog, "title": "Second"}).json()
    second_id = second["columns"][0]["cards"][1]["id"]

    monkeypatch.setattr(
        main_module,
        "request_board_actions",
        lambda board, message, history: {
            "reply": "Updated the board.",
            "actions": [
                {"action": "edit", "card_id": first_id, "title": "Renamed", "details": "Updated"},
                {"action": "move", "card_id": second_id, "column_id": discovery, "position": 0},
                {"action": "create", "title": "Third", "details": "New", "column_id": backlog, "position": 0},
            ],
        },
    )
    response = client.post("/api/ai/chat", json={"message": "Apply these changes"})

    assert response.status_code == 200
    board = client.get("/api/board").json()
    assert [card["title"] for card in board["columns"][0]["cards"]] == ["Third", "Renamed"]
    assert board["columns"][0]["cards"][1]["details"] == "Updated"
    assert [card["title"] for card in board["columns"][1]["cards"]] == ["Second"]


@pytest.mark.parametrize(
    "provider_response",
    [
        {"reply": "Bad", "actions": [{"action": "move", "card_id": 9999, "column_id": 1, "position": 0}]},
        {"reply": "Bad", "actions": [{"action": "unknown"}]},
    ],
)
def test_ai_chat_rejects_invalid_response_without_partial_update(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, provider_response: dict
) -> None:
    sign_in(client)
    before = client.get("/api/board").json()
    monkeypatch.setattr(main_module, "request_board_actions", lambda board, message, history: provider_response)

    response = client.post("/api/ai/chat", json={"message": "Do it"})

    assert response.status_code in (422, 502)
    assert client.get("/api/board").json() == before


def test_ai_chat_provider_error_and_user_isolation(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    sign_in(client)
    own_board = client.get("/api/board").json()
    monkeypatch.setattr(main_module, "request_board_actions", lambda board, message, history: (_ for _ in ()).throw(openrouter.OpenRouterError("provider_error")))
    assert client.post("/api/ai/chat", json={"message": "Hello"}).status_code == 502

    anonymous = TestClient(client.app)
    assert anonymous.post("/api/ai/chat", json={"message": "Hello"}).status_code == 401
    assert client.get("/api/board").json() == own_board

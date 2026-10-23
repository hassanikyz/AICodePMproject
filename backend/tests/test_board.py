import sqlite3
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import SESSION_COOKIE, create_app


@pytest.fixture
def setup(tmp_path: Path) -> tuple[TestClient, Path]:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("Board")
    path = tmp_path / "board.sqlite3"
    client = TestClient(create_app(static, path))
    client.post("/api/login", json={"username": "user", "password": "password"})
    return client, path


def columns(board: dict) -> list[dict]:
    return board["columns"]


def test_initialization_is_idempotent_and_new_database_is_empty(setup: tuple[TestClient, Path]) -> None:
    client, path = setup
    assert path.exists()
    first = client.get("/api/board").json()
    assert [col["title"] for col in columns(first)] == list(db.DEFAULT_COLUMNS)
    assert [col["position"] for col in columns(first)] == list(range(5))
    assert all(not col["cards"] for col in columns(first))

    db.initialize(path)
    with db.connection(path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM boards").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM board_columns").fetchone()[0] == 5
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert client.get("/api/board").json() == first

    fresh = path.parent / "fresh.sqlite3"
    db.initialize(fresh)
    with db.connection(fresh) as conn:
        assert all(not col["cards"] for col in columns(db.board(conn, 1)))


def test_board_crud_move_reorder_delete_and_restart(setup: tuple[TestClient, Path]) -> None:
    client, path = setup
    initial = client.get("/api/board").json()
    backlog, discovery, _, review, _ = [col["id"] for col in columns(initial)]
    renamed = client.patch(f"/api/columns/{backlog}", json={"title": "  Ideas  "}).json()
    assert columns(renamed)[0]["title"] == "Ideas"
    assert [col["id"] for col in columns(renamed)] == [col["id"] for col in columns(initial)]

    def create(title: str, column_id: int) -> dict:
        response = client.post("/api/cards", json={"title": title, "column_id": column_id})
        assert response.status_code == 201
        return response.json()

    board = create("First", backlog)
    first_id = columns(board)[0]["cards"][0]["id"]
    board = create("Second", backlog)
    second_id = columns(board)[0]["cards"][1]["id"]
    board = create("Third", backlog)
    third_id = columns(board)[0]["cards"][2]["id"]
    board = create("Review item", review)
    review_id = columns(board)[3]["cards"][0]["id"]

    edited = client.patch(f"/api/cards/{first_id}", json={"title": "Revised", "details": "Body"}).json()
    assert columns(edited)[0]["cards"][0]["details"] == "Body"
    assert columns(edited)[0]["cards"][0]["title"] == "Revised"

    board = client.post(f"/api/cards/{third_id}/move", json={"column_id": backlog, "position": 0}).json()
    assert [card["id"] for card in columns(board)[0]["cards"]] == [third_id, first_id, second_id]
    board = client.post(f"/api/cards/{first_id}/move", json={"column_id": review, "position": 0}).json()
    assert [card["id"] for card in columns(board)[0]["cards"]] == [third_id, second_id]
    assert [card["id"] for card in columns(board)[3]["cards"]] == [first_id, review_id]
    board = client.post(f"/api/cards/{second_id}/move", json={"column_id": discovery, "position": 0}).json()
    assert columns(board)[1]["cards"][0]["id"] == second_id
    assert [card["position"] for col in columns(board) for card in col["cards"]] == [0, 0, 0, 1]

    board = client.delete(f"/api/cards/{first_id}").json()
    assert [card["position"] for card in columns(board)[3]["cards"]] == [0]
    assert columns(board)[3]["cards"][0]["id"] == review_id

    restarted = TestClient(create_app(path.parent / "static", path))
    restarted.post("/api/login", json={"username": "user", "password": "password"})
    assert restarted.get("/api/board").json() == board


def test_invalid_input_missing_ids_and_failed_move_is_atomic(setup: tuple[TestClient, Path]) -> None:
    client, path = setup
    backlog, review = [col["id"] for col in columns(client.get("/api/board").json())][0::3][:2]
    first = client.post("/api/cards", json={"column_id": backlog, "title": "One"}).json()
    card_id = columns(first)[0]["cards"][0]["id"]
    before = client.get("/api/board").json()

    for method, url, payload, status in [
        ("patch", "/api/columns/9999", {"title": "x"}, 404),
        ("patch", f"/api/columns/{backlog}", {"title": "  "}, 422),
        ("post", "/api/cards", {"column_id": 9999, "title": "x"}, 404),
        ("post", "/api/cards", {"column_id": backlog, "title": " "}, 422),
        ("patch", "/api/cards/9999", {"title": "x", "details": ""}, 404),
        ("patch", f"/api/cards/{card_id}", {"title": " ", "details": ""}, 422),
        ("delete", "/api/cards/9999", None, 404),
        ("post", "/api/cards/9999/move", {"column_id": review, "position": 0}, 404),
        ("post", f"/api/cards/{card_id}/move", {"column_id": 9999, "position": 0}, 404),
        ("post", f"/api/cards/{card_id}/move", {"column_id": review, "position": 2}, 422),
        ("post", f"/api/cards/{card_id}/move", {"column_id": backlog, "position": -1}, 422),
    ]:
        response = getattr(client, method)(url, json=payload) if payload is not None else getattr(client, method)(url)
        assert response.status_code == status, (url, response.text)
        assert client.get("/api/board").json() == before

    with db.connection(path) as conn:
        board_id = before["id"]
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO cards (board_id, column_id, position, title) VALUES (?, ?, 0, 'cross')",
                (board_id + 1, backlog),
            )

    # A database failure after positions have been parked must roll back the move.
    with pytest.raises(sqlite3.IntegrityError):
        with db.connection(path) as conn:
            db.resequence(conn, {backlog: [], 9999: [card_id]})
    assert client.get("/api/board").json() == before


def test_unauthenticated_and_second_user_isolation(setup: tuple[TestClient, Path]) -> None:
    client, path = setup
    first = client.get("/api/board").json()
    own_column = columns(first)[0]["id"]
    own_card = client.post("/api/cards", json={"column_id": own_column, "title": "Private"}).json()
    own_card_id = columns(own_card)[0]["cards"][0]["id"]

    anonymous = TestClient(client.app)
    for method, url, payload in [
        ("get", "/api/board", None),
        ("patch", f"/api/columns/{own_column}", {"title": "No"}),
        ("post", "/api/cards", {"column_id": own_column, "title": "No"}),
        ("patch", f"/api/cards/{own_card_id}", {"title": "No", "details": ""}),
        ("delete", f"/api/cards/{own_card_id}", None),
        ("post", f"/api/cards/{own_card_id}/move", {"column_id": own_column, "position": 0}),
    ]:
        response = getattr(anonymous, method)(url, json=payload) if payload is not None else getattr(anonymous, method)(url)
        assert response.status_code == 401

    with db.connection(path) as conn:
        other_id = conn.execute("INSERT INTO users (username) VALUES ('other')").lastrowid
    token = "second-user-session"
    client.app.state.sessions[token] = (other_id, time.time() + 3600)
    other = TestClient(client.app)
    other.cookies.set(SESSION_COOKIE, token)
    other_board = other.get("/api/board").json()
    assert other_board["id"] != first["id"]
    assert len(columns(other_board)) == 5
    assert all(not col["cards"] for col in columns(other_board))
    other_column = columns(other_board)[0]["id"]

    for method, url, payload in [
        ("patch", f"/api/columns/{own_column}", {"title": "No"}),
        ("post", "/api/cards", {"column_id": own_column, "title": "No"}),
        ("patch", f"/api/cards/{own_card_id}", {"title": "No", "details": ""}),
        ("delete", f"/api/cards/{own_card_id}", None),
        ("post", f"/api/cards/{own_card_id}/move", {"column_id": other_column, "position": 0}),
    ]:
        response = getattr(other, method)(url, json=payload) if payload is not None else getattr(other, method)(url)
        assert response.status_code == 404
    assert other.post(f"/api/cards/{own_card_id}/move", json={"column_id": own_column, "position": 0}).status_code == 404
    assert client.get("/api/board").json() == own_card
    assert other.get("/api/board").json() == other_board

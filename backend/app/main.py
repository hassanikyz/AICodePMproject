import secrets
import time
import os
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Path as PathParam, Request, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

from . import db
from .ai import MAX_ID, AIChatRequest, AIChatResponse, Details, RowId, Title, apply_actions
from .openrouter import OpenRouterError, check_connectivity, request_board_actions

SESSION_COOKIE = "pm_session"
SESSION_SECONDS = 8 * 60 * 60
PathId = Annotated[int, PathParam(ge=1, le=MAX_ID)]


class LoginCredentials(BaseModel):
    username: str
    password: str


class TitleChange(BaseModel):
    title: Title

    @field_validator("title")
    @classmethod
    def nonempty_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Title must not be empty")
        return value


class CardCreate(TitleChange):
    column_id: RowId
    details: Details = ""


class CardEdit(TitleChange):
    details: Details


class CardMove(BaseModel):
    column_id: RowId
    position: RowId


def current_user(request: Request) -> int | None:
    token = request.cookies.get(SESSION_COOKIE)
    session = request.app.state.sessions.get(token)
    if session is None:
        return None
    user_id, expires_at = session
    if expires_at <= time.time():
        request.app.state.sessions.pop(token, None)
        return None
    return user_id


def require_user(request: Request) -> int:
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in required")
    return user


def create_app(static_dir: Path, database_path: Path) -> FastAPI:
    db.initialize(database_path)
    app = FastAPI()
    app.state.sessions = {}
    app.state.database_path = database_path

    def board_for(user_id: int) -> dict:
        with db.connection(database_path) as conn:
            return db.board(conn, user_id)

    @app.post("/api/login")
    def login(credentials: LoginCredentials, response: Response) -> dict[str, bool]:
        if not (
            secrets.compare_digest(credentials.username.encode(), b"user")
            and secrets.compare_digest(credentials.password.encode(), b"password")
        ):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        with db.connection(database_path) as conn:
            user_id = conn.execute("SELECT id FROM users WHERE username = 'user'").fetchone()["id"]
        token = secrets.token_urlsafe(32)
        app.state.sessions[token] = (user_id, time.time() + SESSION_SECONDS)
        response.set_cookie(
            key=SESSION_COOKIE,
            value=token,
            max_age=SESSION_SECONDS,
            httponly=True,
            samesite="strict",
            path="/",
        )
        return {"authenticated": True}

    @app.get("/api/session")
    def session(request: Request) -> dict[str, bool]:
        return {"authenticated": current_user(request) is not None}

    @app.post("/api/logout")
    def logout(request: Request, response: Response) -> dict[str, bool]:
        app.state.sessions.pop(request.cookies.get(SESSION_COOKIE), None)
        response.delete_cookie(key=SESSION_COOKIE, path="/")
        return {"authenticated": False}

    @app.get("/api/hello", dependencies=[Depends(require_user)])
    def hello() -> dict[str, str]:
        return {"message": "Hello from FastAPI"}

    @app.post("/api/ai/check")
    def ai_check(_: int = Depends(require_user)) -> dict[str, str]:
        try:
            return {"answer": check_connectivity()}
        except OpenRouterError as exc:
            if str(exc) == "not_configured":
                raise HTTPException(status_code=503, detail="OpenRouter is not configured") from exc
            raise HTTPException(status_code=502, detail="OpenRouter request failed") from exc

    @app.post("/api/ai/chat", response_model=AIChatResponse)
    def ai_chat(payload: AIChatRequest, user_id: int = Depends(require_user)) -> AIChatResponse:
        board = board_for(user_id)
        try:
            raw_response = request_board_actions(
                board,
                payload.message,
                [message.model_dump() for message in payload.history],
            )
            response = AIChatResponse.model_validate(raw_response)
        except OpenRouterError as exc:
            if str(exc) == "not_configured":
                raise HTTPException(status_code=503, detail="OpenRouter is not configured") from exc
            raise HTTPException(status_code=502, detail="OpenRouter request failed") from exc
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="Invalid AI response") from exc

        try:
            with db.connection(database_path) as conn:
                conn.execute("BEGIN IMMEDIATE")
                board_id = db.ensure_board(conn, user_id)
                apply_actions(conn, board_id, response.actions)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return AIChatResponse(reply=response.reply, actions=response.actions)

    @app.get("/api/board")
    def get_board(user_id: int = Depends(require_user)) -> dict:
        return board_for(user_id)

    @app.patch("/api/columns/{column_id}")
    def rename_column(column_id: PathId, change: TitleChange, user_id: int = Depends(require_user)) -> dict:
        with db.connection(database_path) as conn:
            conn.execute("BEGIN IMMEDIATE")
            board_id = db.ensure_board(conn, user_id)
            updated = conn.execute(
                "UPDATE board_columns SET title = ? WHERE id = ? AND board_id = ?",
                (change.title, column_id, board_id),
            )
            if updated.rowcount == 0:
                raise HTTPException(status_code=404, detail="Column not found")
        return board_for(user_id)

    @app.post("/api/cards", status_code=201)
    def create_card(card: CardCreate, user_id: int = Depends(require_user)) -> dict:
        with db.connection(database_path) as conn:
            conn.execute("BEGIN IMMEDIATE")
            board_id = db.ensure_board(conn, user_id)
            if not db.column_exists(conn, board_id, card.column_id):
                raise HTTPException(status_code=404, detail="Column not found")
            position = len(db.ordered_ids(conn, card.column_id))
            conn.execute(
                "INSERT INTO cards (board_id, column_id, position, title, details) VALUES (?, ?, ?, ?, ?)",
                (board_id, card.column_id, position, card.title, card.details),
            )
        return board_for(user_id)

    @app.patch("/api/cards/{card_id}")
    def edit_card(card_id: PathId, change: CardEdit, user_id: int = Depends(require_user)) -> dict:
        with db.connection(database_path) as conn:
            conn.execute("BEGIN IMMEDIATE")
            board_id = db.ensure_board(conn, user_id)
            updated = conn.execute(
                "UPDATE cards SET title = ?, details = ? WHERE id = ? AND board_id = ?",
                (change.title, change.details, card_id, board_id),
            )
            if updated.rowcount == 0:
                raise HTTPException(status_code=404, detail="Card not found")
        return board_for(user_id)

    @app.delete("/api/cards/{card_id}")
    def delete_card(card_id: PathId, user_id: int = Depends(require_user)) -> dict:
        with db.connection(database_path) as conn:
            conn.execute("BEGIN IMMEDIATE")
            board_id = db.ensure_board(conn, user_id)
            card = db.card_row(conn, board_id, card_id)
            if card is None:
                raise HTTPException(status_code=404, detail="Card not found")
            conn.execute("DELETE FROM cards WHERE id = ?", (card_id,))
            db.resequence(conn, {card["column_id"]: db.ordered_ids(conn, card["column_id"])})
        return board_for(user_id)

    @app.post("/api/cards/{card_id}/move")
    def move_card(card_id: PathId, move: CardMove, user_id: int = Depends(require_user)) -> dict:
        with db.connection(database_path) as conn:
            conn.execute("BEGIN IMMEDIATE")
            board_id = db.ensure_board(conn, user_id)
            card = db.card_row(conn, board_id, card_id)
            if card is None:
                raise HTTPException(status_code=404, detail="Card not found")
            if not db.column_exists(conn, board_id, move.column_id):
                raise HTTPException(status_code=404, detail="Column not found")
            source_id = card["column_id"]
            source = db.ordered_ids(conn, source_id)
            source.remove(card_id)
            target = source if source_id == move.column_id else db.ordered_ids(conn, move.column_id)
            if not 0 <= move.position <= len(target):
                raise HTTPException(status_code=422, detail="Position out of range")
            target.insert(move.position, card_id)
            affected = {source_id: source, move.column_id: target}
            db.resequence(conn, affected)
        return board_for(user_id)

    app.mount("/", StaticFiles(directory=static_dir, html=True, check_dir=False), name="frontend")
    return app


app = create_app(
    Path(__file__).parent / "static",
    Path(os.getenv("DATABASE_PATH", Path(__file__).parent / "kanban.sqlite3")),
)

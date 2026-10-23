from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import db

MAX_ID = 2**63 - 1
MAX_TITLE = 200
MAX_DETAILS = 5000
MAX_MESSAGE = 4000
MAX_HISTORY = 50
RowId = Annotated[int, Field(ge=0, le=MAX_ID)]
Title = Annotated[str, Field(max_length=MAX_TITLE)]
Details = Annotated[str, Field(max_length=MAX_DETAILS)]


class AIMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=20 * MAX_MESSAGE)


class CreateAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["create"]
    title: Title
    details: Details = ""
    column_id: RowId
    position: RowId | None = None

    @field_validator("title")
    @classmethod
    def nonempty_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Title must not be empty")
        return value


class EditAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["edit"]
    card_id: RowId
    title: Title
    details: Details

    @field_validator("title")
    @classmethod
    def nonempty_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Title must not be empty")
        return value


class MoveAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["move"]
    card_id: RowId
    column_id: RowId
    position: RowId


AIAction = Annotated[CreateAction | EditAction | MoveAction, Field(discriminator="action")]


class AIChatRequest(BaseModel):
    message: str = Field(max_length=MAX_MESSAGE)
    history: list[AIMessage] = Field(default_factory=list, max_length=MAX_HISTORY)

    @field_validator("message")
    @classmethod
    def nonempty_message(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Message must not be empty")
        return value


class AIChatResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reply: str
    actions: list[AIAction] = []


def apply_actions(conn, board_id: int, actions: list[AIAction]) -> None:
    columns = {
        row["id"]: db.ordered_ids(conn, row["id"])
        for row in conn.execute("SELECT id FROM board_columns WHERE board_id = ?", (board_id,))
    }
    cards = {
        row["id"]: row["column_id"]
        for row in conn.execute("SELECT id, column_id FROM cards WHERE board_id = ?", (board_id,))
    }

    for action in actions:
        if isinstance(action, CreateAction):
            if action.column_id not in columns:
                raise ValueError("Column not found")
            position = len(columns[action.column_id]) if action.position is None else action.position
            if not 0 <= position <= len(columns[action.column_id]):
                raise ValueError("Position out of range")
            columns[action.column_id].insert(position, -(len(cards) + 1))
        elif isinstance(action, EditAction):
            if action.card_id not in cards:
                raise ValueError("Card not found")
        else:
            if action.card_id not in cards:
                raise ValueError("Card not found")
            if action.column_id not in columns:
                raise ValueError("Column not found")
            source_id = cards[action.card_id]
            source = columns[source_id]
            source.remove(action.card_id)
            if not 0 <= action.position <= len(columns[action.column_id]):
                raise ValueError("Position out of range")
            columns[action.column_id].insert(action.position, action.card_id)
            cards[action.card_id] = action.column_id

    for action in actions:
        if isinstance(action, CreateAction):
            ids = db.ordered_ids(conn, action.column_id)
            position = len(ids) if action.position is None else action.position
            ids.insert(position, -1)
            conn.execute(
                "INSERT INTO cards (board_id, column_id, position, title, details) VALUES (?, ?, ?, ?, ?)",
                (board_id, action.column_id, len(ids), action.title, action.details),
            )
            ids[position] = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            db.resequence(conn, {action.column_id: ids})
        elif isinstance(action, EditAction):
            conn.execute(
                "UPDATE cards SET title = ?, details = ? WHERE board_id = ? AND id = ?",
                (action.title, action.details, board_id, action.card_id),
            )
        else:
            card = db.card_row(conn, board_id, action.card_id)
            source_ids = db.ordered_ids(conn, card["column_id"])
            source_ids.remove(action.card_id)
            target_ids = source_ids if card["column_id"] == action.column_id else db.ordered_ids(conn, action.column_id)
            target_ids.insert(action.position, action.card_id)
            db.resequence(conn, {card["column_id"]: source_ids, action.column_id: target_ids})

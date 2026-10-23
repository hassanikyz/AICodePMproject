import sqlite3
from contextlib import contextmanager
from pathlib import Path

DEFAULT_COLUMNS = ("Backlog", "Discovery", "In Progress", "Review", "Done")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE CHECK (length(trim(username)) > 0)
);
CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS board_columns (
    id INTEGER PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 4),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    UNIQUE (board_id, position),
    UNIQUE (board_id, id)
);
CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    column_id INTEGER NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    details TEXT NOT NULL DEFAULT '',
    UNIQUE (column_id, position),
    FOREIGN KEY (board_id, column_id)
        REFERENCES board_columns(board_id, id) ON DELETE CASCADE
);
"""


@contextmanager
def connection(path: Path):
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def initialize(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with connection(path) as db:
        db.executescript(SCHEMA)
        db.execute("INSERT OR IGNORE INTO users (username) VALUES ('user')")
        user_id = db.execute("SELECT id FROM users WHERE username = 'user'").fetchone()["id"]
        ensure_board(db, user_id)


def ensure_board(db: sqlite3.Connection, user_id: int) -> int:
    row = db.execute("SELECT id FROM boards WHERE user_id = ?", (user_id,)).fetchone()
    if row:
        return row["id"]
    board_id = db.execute("INSERT INTO boards (user_id) VALUES (?)", (user_id,)).lastrowid
    db.executemany(
        "INSERT INTO board_columns (board_id, position, title) VALUES (?, ?, ?)",
        ((board_id, position, title) for position, title in enumerate(DEFAULT_COLUMNS)),
    )
    return board_id


def board(db: sqlite3.Connection, user_id: int) -> dict:
    board_id = ensure_board(db, user_id)
    columns = []
    for column in db.execute(
        "SELECT id, title, position FROM board_columns WHERE board_id = ? ORDER BY position",
        (board_id,),
    ):
        cards = [
            dict(card)
            for card in db.execute(
                "SELECT id, title, details, position FROM cards WHERE column_id = ? ORDER BY position",
                (column["id"],),
            )
        ]
        columns.append({**dict(column), "cards": cards})
    return {"id": board_id, "columns": columns}


def column_exists(db: sqlite3.Connection, board_id: int, column_id: int) -> bool:
    return db.execute(
        "SELECT 1 FROM board_columns WHERE board_id = ? AND id = ?", (board_id, column_id)
    ).fetchone() is not None


def card_row(db: sqlite3.Connection, board_id: int, card_id: int):
    return db.execute(
        "SELECT id, column_id, position FROM cards WHERE board_id = ? AND id = ?",
        (board_id, card_id),
    ).fetchone()


def ordered_ids(db: sqlite3.Connection, column_id: int) -> list[int]:
    return [
        row["id"]
        for row in db.execute(
            "SELECT id FROM cards WHERE column_id = ? ORDER BY position", (column_id,)
        )
    ]


def resequence(db: sqlite3.Connection, target_columns: dict[int, list[int]]) -> None:
    # Park every affected card beyond its current column's positions first, then
    # assign dense final positions. This avoids transient UNIQUE collisions.
    for column_id in target_columns:
        ids = ordered_ids(db, column_id)
        maximum = db.execute(
            "SELECT COALESCE(MAX(position), -1) FROM cards WHERE column_id = ?", (column_id,)
        ).fetchone()[0]
        for offset, card_id in enumerate(ids):
            db.execute(
                "UPDATE cards SET position = ? WHERE id = ?",
                (maximum + 1 + offset, card_id),
            )
    for column_id, ids in target_columns.items():
        for position, card_id in enumerate(ids):
            db.execute(
                "UPDATE cards SET column_id = ?, position = ? WHERE id = ?",
                (column_id, position, card_id),
            )

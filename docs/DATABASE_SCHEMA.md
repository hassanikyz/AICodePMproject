# Approved database schema (Parts 5–6)

This is a proposal for review, not an implemented database. The board returned to the frontend follows [board.schema.json](./board.schema.json). Its four examples show an empty board, the same board with “Backlog” renamed to “Ideas,” then a card before and after moving from Backlog to the start of Review. Every example still has five columns; card `101` keeps its ID while its column and position change.

The user approved this model before Part 6. It is implemented in `backend/app/db.py`, and the frontend will use it in Part 7.

## SQLite tables

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE CHECK (length(trim(username)) > 0)
);

CREATE TABLE boards (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE board_columns (
    id INTEGER PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 4),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    UNIQUE (board_id, position),
    UNIQUE (board_id, id)
);

CREATE TABLE cards (
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
```

`users.username` is unique, and `boards.user_id` permits at most one board per user. Each board has positions 0–4 at most once. The application creates exactly five columns and exposes rename only—not column creation or deletion. Cards have a unique position within their column. Existing row IDs never change when a column is renamed or a card is moved. SQLite foreign keys must be enabled on every connection with `PRAGMA foreign_keys = ON`.

The composite card-to-column foreign key makes it impossible to attach a card to a column on a different board. Deleting a user cascades to their board, columns, and cards; deleting a board does the same. The MVP exposes only card deletion. Card moves and reorders will run in one transaction, assigning collision-free temporary positions before the final contiguous positions `0..N-1`; a failed move rolls back entirely. Column and card order in API JSON follows `position`, not insertion order.

## Initialization and ownership

The database file is `/data/kanban.sqlite3` inside the container, backed by the `sqlite_data` Docker volume in [compose.yaml](../compose.yaml). Startup creates the file and tables if absent, then idempotently creates the `user` row, its one board, and these five columns: Backlog, Discovery, In Progress, Review, Done. The initial board has no cards. The hardcoded MVP password remains in the authentication code; it is not stored in this database. Sessions remain in memory for now.

Every board query and mutation resolves the user from the backend session, looks up that user's board, and checks that the target column/card belongs to it. Sessions are bound to a user row; the hardcoded login maps to `user`, while backend test fixtures issue a session for a second test user. The client never supplies an authoritative `user_id` or `board_id`. That second user gets a distinct board with the same five default columns, and their session cannot read or change the first user's rows. Database-level ownership constraints complement these API checks.

## Board API

After signing in, `GET /api/board` returns the board. `PATCH /api/columns/{column_id}` with `{"title":"Ideas"}` renames a column. `POST /api/cards` with `{"column_id":1,"title":"Task","details":""}` creates a card. `PATCH /api/cards/{card_id}` with `{"title":"Task","details":"Notes"}` edits it. `DELETE /api/cards/{card_id}` deletes it. `POST /api/cards/{card_id}/move` with `{"column_id":2,"position":0}` moves or reorders it. Mutations return the updated board. Missing or foreign IDs return 404. The routes can be tried at `/docs` after signing in; the frontend board remains local-only until Part 7.

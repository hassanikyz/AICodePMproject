# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `AGENTS.md` (product requirements, tech decisions, color scheme, coding standards) and `docs/PLAN.md` (staged plan; all 10 parts are currently checked off) before changing anything. `backend/AGENTS.md`, `frontend/AGENTS.md`, and `scripts/AGENTS.md` hold per-area code maps; keep them aligned with the code when it changes. Coding standards from `AGENTS.md` apply: keep it simple, no over-engineering, minimal README, no emojis, and find the root cause with evidence before fixing a bug.

## Architecture

One Docker container runs everything. A multi-stage `Dockerfile` builds the Next.js app as a static export (`frontend/out`), then copies it into `app/static` of a Python image where FastAPI serves it at `/` (mounted last, after all `/api` routes, in `backend/app/main.py`). There is no Node server at runtime.

- **Backend** (`backend/app/`): `create_app(static_dir, database_path)` in `main.py` builds the FastAPI app (tests call it with temp paths). Auth is hardcoded `user` / `password`, with an HTTP-only cookie backed by in-memory sessions (lost on restart). `db.py` owns the SQLite schema and board operations (one board per user, five fixed columns that can only be renamed, cards ordered per column; moves are resequenced atomically). `ai.py` defines the Structured Outputs models (create/edit/move actions) and applies a validated action batch in one transaction; `openrouter.py` calls `openai/gpt-oss-120b` using `OPENROUTER_API_KEY`. The schema is documented in `docs/DATABASE_SCHEMA.md` and `docs/board.schema.json`.
- **Frontend** (`frontend/src/`): `AppShell` checks the backend session and shows sign-in or the board plus `ChatSidebar`. `KanbanBoard` loads and mutates the board through `lib/boardApi.ts`; `lib/aiApi.ts` calls the AI endpoint, and the board refreshes from the backend after AI card actions. All state of record lives in SQLite, not in the client.
- **Config**: `DATABASE_PATH` selects the SQLite file (`/data/kanban.sqlite3` in Docker, on the `sqlite_data` volume). `.env` in the repo root supplies the API key to the container via Compose and is excluded from the image.

## Commands

Run the app (Docker with Compose required): `sh scripts/start.sh` / `sh scripts/stop.sh` (Mac/Linux) or `scripts\start.ps1` / `scripts\stop.ps1` / `.bat` (Windows). Serves `http://localhost:8000`, login `user` / `password`. Stop preserves the data volume.

Backend (from `backend/`):
- `uv sync --locked` to install
- `uv run --locked pytest` to test; single test: `uv run --locked pytest tests/test_board.py::test_name`
- `uv run --locked pytest --cov=app` for coverage

Frontend (from `frontend/`):
- `npm run dev`, `npm run build`, `npm run lint`
- `npm run test:unit` (Vitest, `src/**/*.test.ts(x)`); single file: `npx vitest run src/components/ChatSidebar.test.tsx`; single test: add `-t "name"`
- `npm run test:e2e` (Playwright in `tests/`) runs against the already-running container at `127.0.0.1:8000`, so rebuild and start the container first; override with `PLAYWRIGHT_BASE_URL`.

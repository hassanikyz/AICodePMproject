# Backend code map

This FastAPI app serves the exported Next.js board. The root [`docs/PLAN.md`](../docs/PLAN.md) defines the remaining frontend integration and AI work.

- `pyproject.toml` declares runtime dependencies and the test dependency group; `uv.lock` pins resolved versions. Use `uv sync --locked` when working locally.
- `app/main.py` provides hardcoded MVP login, an HTTP-only cookie backed by in-memory expiring sessions, session status, logout, and authenticated board API routes. It mounts the exported frontend at `/` after API routes.
- `app/openrouter.py` provides the backend-only OpenRouter connectivity check for `openai/gpt-oss-120b`; `POST /api/ai/check` requires the MVP session and never returns the API key.
- `app/db.py` initializes the approved SQLite schema, one board with five columns per user, and board reads/reordering. `DATABASE_PATH` selects the file (`/data/kanban.sqlite3` in Docker). Every connection enables foreign keys.
- The Docker frontend stage builds `frontend/out` and copies it into `app/static` in the Python image.
- `tests/test_main.py` covers authentication and static routes; `tests/test_board.py` covers persistence, board mutations, ordering, validation, and user isolation. Run with `uv run --locked pytest` from `backend/`.

The Docker build installs runtime dependencies with `uv`. Sessions are lost on container restart, but board data persists in the `/data` volume. `OPENROUTER_API_KEY` is supplied to the container through Compose's root `.env` file and is not included in the image.

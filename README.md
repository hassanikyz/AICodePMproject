# Project Management MVP

The container serves the local Kanban demo at `http://localhost:8000`. Sign in with `user` / `password`. The backend board API persists data in SQLite. API routes can be tried at `http://localhost:8000/docs` after signing in. Docker with Compose is required.

OpenRouter connectivity requires `OPENROUTER_API_KEY` in the root `.env`. Compose injects it into the backend at runtime; it is not copied into the image or exposed to the frontend. After starting the container and signing in, run `curl -X POST http://localhost:8000/api/ai/check -b cookies.txt` using an authenticated session to send the fixed `2+2` check. The signed-in board also includes an AI assistant sidebar for board questions and validated card create, edit, and move requests.

Start: `sh scripts/start.sh` on Mac/Linux, or `scripts\start.bat` / `scripts\start.ps1` on Windows.

Stop: `sh scripts/stop.sh` on Mac/Linux, or `scripts\stop.bat` / `scripts\stop.ps1` on Windows. Stopping preserves the SQLite data volume.

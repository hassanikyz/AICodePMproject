# Code review

Date: 2026-10-23. Scope: the whole repository at commit `8165f8e` (backend, frontend, Docker, scripts, docs, tests).

## Method and evidence

- Read every source file in `backend/app`, `frontend/src`, the Docker and Compose files, the start/stop scripts, and the docs; skimmed the test suites and the Playwright spec.
- Ran the full suite: 18 backend tests, 19 frontend unit tests, 7 browser tests against the container, lint, and the production build all pass.
- Probed the running API with a throwaway script (not committed) to confirm the three robustness findings in H1 and H2 below.
- Ran `npm audit --omit=dev` for the dependency finding in M5.

Findings are ranked High, Medium, Low. Each has a location, the evidence, and a concrete action. The consolidated checklist is at the end.

## Summary

The code is small, readable, and consistent with the "keep it simple" standard. SQL is fully parameterized, every board operation is scoped by the authenticated user's board, AI action batches are applied in one rolled-back-on-failure transaction, and the secret stays server-side. The main weaknesses are unhandled-input crashes (500s) on the API, no input size limits, the container being reachable from the network with a hardcoded login, duplicated board logic between the REST routes and the AI path, and tests that do not exercise the AI path end to end.

Things checked and found sound: no SQL injection; `.env` is gitignored and excluded from the Docker context; session cookie is HTTP-only and `SameSite=Strict`; cross-user access is rejected by `board_id` scoping; `httpx2` in the dev dependencies is correct (Starlette 1.9 requires it, see `starlette/testclient.py`); the five-column constraint is enforced in the schema.

## High

### H1. Non-ASCII login credentials return HTTP 500

- Location: `backend/app/main.py:80-83`.
- Evidence: `POST /api/login` with username `usér` returned 500. `secrets.compare_digest` raises `TypeError` for `str` arguments containing non-ASCII characters.
- Impact: any visitor can trigger server errors; it also hides the real "invalid credentials" response.
- Action: compare as bytes, `secrets.compare_digest(credentials.username.encode(), b"user")`, or compare after encoding both sides. Add a test with a non-ASCII username and password expecting 401.

### H2. Oversized integers crash the API; no size limits on text

- Location: `backend/app/main.py` (all `card_id`, `column_id`, `position` inputs); `TitleChange`, `CardCreate`, `CardEdit`, `AIChatRequest`.
- Evidence: `PATCH /api/cards/99999999999999999999` and `POST /api/cards` with `column_id: 99999999999999999999` both returned 500 (SQLite integer overflow). A 5 MB card title was accepted with 201.
- Impact: 500s on trivial bad input; unbounded storage and an unbounded prompt size sent to the paid OpenRouter API (see M2).
- Action: constrain IDs and positions with `Field(ge=0, le=2**63 - 1)` or `conint`, and the path IDs with `Path(ge=1, le=2**63 - 1)`. Add `max_length` to titles (for example 200), card details (for example 5000), chat message (for example 4000), and a cap on `history` length. Add tests for the oversized and over-long cases.

### H3. The container is exposed on all interfaces with a hardcoded login

- Location: `compose.yaml:4-5` (`"8000:8000"`).
- Evidence: Docker publishes the port on `0.0.0.0`; the only credentials are `user` / `password`, and the signed-in session can call the paid AI endpoint.
- Impact: anyone on the same network can sign in and spend the OpenRouter key's credit. The requirements say the app runs locally.
- Action: bind to loopback, `"127.0.0.1:8000:8000"`. Playwright and the docs already use `127.0.0.1`/`localhost`, so nothing else changes.

## Medium

### M1. Board logic is implemented twice (REST routes and AI actions)

- Location: `backend/app/main.py:165-223` and `backend/app/ai.py:80-136`.
- Evidence: create-card and move-card are implemented in both places, with different position handling. `apply_actions` runs a first pass that simulates the batch with placeholder IDs (`-(len(cards) + 1)` at `ai.py:97`, `-1` at `ai.py:118`), then a second pass that repeats the work against the database. Because the whole batch already runs inside one transaction that rolls back on any error, the simulation pass is redundant.
- Impact: two code paths to keep consistent; the placeholder trick is hard to follow and easy to break.
- Action: move `create_card`, `edit_card`, and `move_card` into `db.py`, each raising `ValueError` on bad input; have the routes translate to 404/422 and have `apply_actions` loop over the actions calling the same functions inside the existing transaction. Delete the validation pass. The existing atomicity tests (`test_ai_chat_applies_multiple_ordered_actions_transactionally`, `test_ai_chat_rejects_invalid_response_without_partial_update`) should pass unchanged and act as the safety net.

### M2. AI endpoint has no request limits or abuse controls

- Location: `backend/app/main.py:122-146`, `backend/app/ai.py:60-70`.
- Evidence: `history` is unbounded, the full board JSON is embedded in every prompt, and the frontend sends the entire conversation each time (`ChatSidebar.tsx:21`, `aiApi.ts:19`).
- Impact: cost and latency grow without bound over a long session; combined with H3, an unauthenticated-network risk.
- Action: after H2's limits, also cap total history (for example last 20 messages) on the server, and trim it on the client. A simple per-session rate limit is optional for the MVP.

### M3. Provider failures are invisible; no logging anywhere

- Location: `backend/app/openrouter.py:54-55` and `95-96`; `backend/app/main.py:115-137`.
- Evidence: every provider failure is collapsed into `OpenRouterError("provider_error")` and returned as a generic 502. The HTTP status and response body from OpenRouter are discarded, and the repository contains no `logging` use.
- Impact: when the AI feature fails (bad key, rate limit, model not available, schema rejected by the provider), the only evidence is "OpenRouter request failed". This directly conflicts with the project rule to find root causes with evidence.
- Action: log the provider status code and a truncated body (never the key or the Authorization header) at warning level before raising; log unhandled request errors. Keep the client-facing message generic.

### M4. Import-time side effects create the production database

- Location: `backend/app/main.py:229-232`.
- Evidence: `app = create_app(...)` runs at import and calls `db.initialize`, which creates `backend/app/kanban.sqlite3` whenever the module is imported. `backend/tests/test_main.py` imports `app.main`, and that file exists in the working tree after a test run (it is ignored by `*.sqlite3`, so it is not committed).
- Impact: running tests writes a real database next to the source and can lock or pollute it on OneDrive.
- Action: build the app lazily, using uvicorn's factory mode (`uvicorn app.main:create_default_app --factory`) or a FastAPI lifespan that initializes the database. Update the Dockerfile `CMD` accordingly.

### M5. Production-labeled dependency advisories and no update path

- Location: `frontend/package.json` (`"next": "16.1.6"`, exact pin).
- Evidence: `npm audit --omit=dev` reports 6 vulnerabilities (1 critical in `next`, 4 high via `postcss`, `sharp`, `nanoid`, `source-map-js`, 1 moderate). npm reports a non-major fix, `next@16.4.3`.
- Impact: limited at runtime, because Next.js only runs in the Docker build stage and the runtime image serves static files, but the build tooling is affected and the project plan already notes this as open (PLAN.md, Part 3).
- Action: bump `next` and `eslint-config-next` to the fixed version, run `npm audit` again, and re-run lint, unit, build, and browser tests. Consider enabling Dependabot or a monthly audit.

### M6. The AI path is never tested end to end; browser tests mutate real data

- Location: `frontend/tests/kanban.spec.ts:152-205`; `backend/tests/test_main.py`.
- Evidence: the chat browser test replaces both `/api/board` and `/api/ai/chat` with Playwright route mocks, so the "persists after refresh" assertion is satisfied by the mocked board, not by SQLite. Backend tests mock `request_board_actions`, so the real OpenRouter payload and the response schema (`oneOf` in strict `json_schema` mode, `openrouter.py:8-25`) are only verified by a manual check. The other browser tests run against the live container and its persistent volume, so they create, reorder, and delete cards in the real board.
- Impact: a regression in the real chat-to-database path, or a provider rejecting the schema, would not be caught; running the tests can leave the user's data in a changed order.
- Action: (1) make the browser tests stub only the OpenRouter call, for example an `OPENROUTER_BASE_URL` override pointing at a tiny stub server, and let the real `/api/board` and `/api/ai/chat` run; (2) run the e2e tests against a throwaway Compose project with its own volume (`docker compose -p pm-test`, separate port); (3) add one opt-in test, skipped without a key, that sends a read-only question to the real model.

### M7. Drag and drop is not keyboard accessible

- Location: `frontend/src/components/KanbanBoard.tsx:57-61`.
- Evidence: only `PointerSensor` is registered; `KeyboardSensor` is not. The "Move" button in `KanbanCard.tsx:70` carries the drag listeners but cannot be operated from the keyboard.
- Impact: the core interaction cannot be used without a pointer.
- Action: add `useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })` from `@dnd-kit/sortable`, and add a keyboard test.

### M8. Edits are silently dropped while a save is in flight

- Location: `frontend/src/components/KanbanBoard.tsx:41-43`.
- Evidence: `save` returns `false` immediately when `saving` is true, with no message and no queue. A drag-drop or column rename that happens during another request is discarded; for a drop the UI has already moved on and the card snaps back on the next refresh.
- Impact: lost user edits on a slow connection or with a slow AI-triggered refresh.
- Action: queue requests by chaining promises, or show "Saving..." and disable inputs; at minimum set the error message "Still saving, try again" when the guard fires.

## Low

### L1. Leftover scaffolding from earlier plan stages

- `GET /api/hello` (`main.py:109-111`) is the Part 2 example endpoint, now used only as an "am I signed in" probe in tests (`test_main.py`, `kanban.spec.ts`). Replace those probes with `/api/session` or `/api/board`, then delete the route.
- `POST /api/ai/check` (`main.py:113-120`) and `check_connectivity` (`openrouter.py:32-63`) are the Part 8 diagnostic. Keep only if still wanted for the documented check; otherwise remove with its tests, and reuse one shared request helper (below).
- `initialData` and `createId` in `frontend/src/lib/kanban.ts:18-72, 165-169` are unused by the app and tests (the grep found no references outside the file); `frontend/AGENTS.md` still says `kanban.ts` "seeds five columns and example cards". Remove them.
- `frontend/README.md` and `frontend/public/*.svg` are create-next-app boilerplate. Remove the unused assets and replace the README with a pointer to the root README.

### L2. Duplicated code

- `openrouter.py` builds and sends the same HTTP request twice (`check_connectivity`, `request_board_actions`). Extract one `_chat(payload, timeout)` helper.
- The "title must not be empty" validator is written three times (`main.py:26-32`, `ai.py:22-28`, `ai.py:39-45`). Define one `Title` annotated type and reuse it.
- `main.py` repeats the same `with db.connection(...): BEGIN IMMEDIATE; ensure_board` preamble in six routes. A small context manager `board_transaction(user_id)` would remove it.

### L3. Generated and personal files are tracked

- `frontend/test-results/.last-run.json` is committed and rewritten by every Playwright run, which produces noisy diffs. Add `frontend/test-results/` and `playwright-report/` to `.gitignore` and `git rm --cached` the file.
- `.vscode/settings.json` is a personal editor setting; either ignore it or keep it deliberately.
- `.gitignore` is the stock Python template and has no entries for Node (`node_modules` and `.next` are covered only by `frontend/.gitignore`).

### L4. Session handling details

- `app.state.sessions` (`main.py:71`) only drops an expired token when that same token is presented again, so unused expired sessions accumulate until restart. Purge expired entries on login.
- The cookie has no `Secure` flag (`main.py:89-96`). That is correct for plain-HTTP localhost, but add a comment or an environment switch before any non-local use.
- Login has no throttling. Acceptable for a hardcoded local MVP; note it as a known limit in the README before any shared deployment.

### L5. Container hardening

- `Dockerfile`: the runtime stage runs as root; add a non-root user and make `/data` writable by it. There is no `HEALTHCHECK` (`GET /api/session` is a cheap probe) and `compose.yaml` has no restart policy.
- `Dockerfile:1,9` use floating major tags (`node:24-slim`, `python:3.14-slim`). Pin to a minor or digest for reproducible builds.
- `compose.yaml` passes the whole `.env` through `env_file`; fine now, but pass only `OPENROUTER_API_KEY` if more variables are added.

### L6. Smaller code points

- `backend/app/db.py:114-132` `resequence` issues one `UPDATE` per card twice per move. Fine at this scale; note it if boards grow.
- `AIChatResponse` (`ai.py:73-77`) validates model output and is also reused as the HTTP response, so a future change to the model-facing schema changes the public API. Use separate models if they diverge.
- `KanbanColumn.tsx:57` blurs on Enter but Escape does not cancel the rename; add Escape to reset the draft.
- `AppShell.tsx:105` hardcodes "Signed in as user"; fine for the MVP, but the session endpoint could return the username.
- `ChatSidebar` does not call the shared session-expired handler, so after a 401 in chat the board stays visible until its next request. Pass `sessionExpired` down for consistent behavior.
- Prompt-injection note: card titles and details are inserted into the model prompt (`openrouter.py:72`). The blast radius is limited to create/edit/move on the same user's board, and all actions are validated, so this is accepted for the MVP; keep it that way if any new action types are added.

### L7. Documentation drift

- `docs/DATABASE_SCHEMA.md:3` still says "This is a proposal for review, not an implemented database", although it is implemented in `db.py`.
- `backend/AGENTS.md` says the plan "defines the remaining frontend integration and AI work" (all parts are complete), does not mention `app/ai.py`, and describes `openrouter.py` as connectivity-only.
- `frontend/AGENTS.md` describes `kanban.ts` seed data that is unused (see L1).
- The top-level README is accurate and minimal.

## Test review

- Strengths: backend tests cover authentication, ordering, atomic failure, restart persistence, and user isolation; frontend tests cover load, mutation failure, and session expiry; coverage is reported at about 96% backend and 89% frontend in PLAN.md.
- Gaps to add, in priority order: non-ASCII and oversized input (H1, H2); real chat flow end to end (M6); keyboard drag-and-drop (M7); concurrent saves (M8); a regression test that importing `app.main` does not create a database file (M4).

## Action checklist

Do these in order; each is small and independent unless noted.

1. [ ] H1: make the login comparison byte-safe; add a non-ASCII login test.
2. [ ] H2: add ID range, text length, and history-size limits; add tests.
3. [ ] H3: bind the published port to `127.0.0.1`.
4. [ ] M3: add provider logging (status and truncated body, never the key).
5. [ ] M4: remove the import-time database creation (factory or lifespan); update the Dockerfile `CMD`.
6. [ ] M1: move card operations into `db.py`, reuse them from routes and AI; delete the simulation pass. Run the atomicity tests unchanged.
7. [ ] M2: cap history on the server and trim it on the client.
8. [ ] M5: upgrade `next` and `eslint-config-next`; re-run audit, lint, unit, build, and browser tests.
9. [ ] M6: run browser tests against a throwaway Compose project; stub only the provider; add the opt-in real-model check.
10. [ ] M7: add `KeyboardSensor` and a keyboard test.
11. [ ] M8: queue or visibly reject concurrent saves.
12. [ ] L1: remove `/api/hello` (after switching its test probes), unused `initialData` and `createId`, and the create-next-app boilerplate.
13. [ ] L2: extract the shared OpenRouter request helper, the title type, and the board-transaction context manager.
14. [ ] L3: ignore and untrack `frontend/test-results/`; decide on `.vscode/`.
15. [ ] L4 and L5: purge expired sessions; add a non-root user, `HEALTHCHECK`, and pinned base images.
16. [ ] L6: Escape-to-cancel for column rename; propagate session expiry from chat.
17. [ ] L7: refresh `DATABASE_SCHEMA.md`, `backend/AGENTS.md`, and `frontend/AGENTS.md` to match the code.

After the changes, re-run the full verification: `uv run --locked pytest` in `backend/`; `npm run test:unit`, `npm run lint`, `npm run build`, and `npm run test:e2e` in `frontend/` against a freshly built container; then stop the container with the supplied script.

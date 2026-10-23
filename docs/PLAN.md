# Project Management MVP plan

Work through the parts in order. Check an item only after its implementation and relevant tests are complete. At the end of **every part**, show the result and test evidence to the user and wait for approval before starting the next part. Part 5 also requires explicit approval of the proposed database schema before Part 6.

The existing frontend is a Next.js demo with five fixed columns, local-state card add/delete and drag-and-drop, Vitest tests, and Playwright tests. It does not yet edit cards, authenticate, persist data, or call a backend. The completed app will use one runtime Docker container: a build stage exports the Next.js site, and FastAPI serves those static files at `/` alongside the API. SQLite data lives in a mounted Docker volume.

## Testing approach

- For each code-producing part, add focused unit tests for meaningful behavior and boundary cases, plus integration or browser tests where components interact. Do not write tests that merely repeat implementation details.
- If a piece is hard to test because responsibilities are tangled, simplify or refactor it first, then test the resulting behavior.
- Measure backend and frontend coverage as the app develops and aim for about 80% overall coverage. Treat the number as a diagnostic, not a quota: explain important gaps, prioritize risky behavior, and do not add low-value tests solely to raise the percentage.
- At each part's approval gate, report the tests run and any remaining coverage or validation gaps.

## Part 1: Plan and frontend inventory

- [x] Review the existing frontend components, data types, styling, and tests; record its current behavior and known gaps in `frontend/AGENTS.md`.
- [x] Review all ten parts below for scope, dependencies, tests, and success criteria; revise the plan with the user if needed.
- [x] Obtain the user's approval of this plan before starting Part 2.

Tests and review:

- [x] Verify `frontend/AGENTS.md` accurately names the main files, current interactions, and test commands by checking it against the source.
- [x] Verify every part has a checklist, tests, and an observable completion criterion.

Success criteria: The plan is approved, and `frontend/AGENTS.md` describes the actual demo rather than intended future behavior.

## Part 2: Docker and backend scaffolding

- [x] Create a minimal FastAPI app in `backend/`, managed with `uv` and a locked dependency set.
- [x] Add a Docker build for the FastAPI runtime; serve a simple example HTML page at `/` for this part before integrating the real frontend in Part 3.
- [x] Add a same-origin example API endpoint and have the example page call it and display the response.
- [x] Add Docker Compose configuration for the single runtime service, a persistent SQLite volume mount, and local port mapping.
- [x] Add start and stop scripts in `scripts/` for Mac and Linux (`.sh`) and Windows (`.ps1` and `.bat`), with concise usage instructions.
- [x] Update `backend/AGENTS.md` and `scripts/AGENTS.md` to describe what actually exists; keep the root README minimal.

Tests:

- [x] Backend test verifies the example API response and the example page route.
- [x] Build and start the image; request `/`, confirm the page displays the API response, then stop it with the supplied script.
- [x] Confirm the expected Docker volume and port are configured and that `.env` is excluded from the build context.

Docker smoke test status: Docker Desktop's Linux engine runs with WSL. The image builds; the container serves `/` and `/api/hello` on port 8000, and the page displays the API response. Both Windows PowerShell and batch start/stop scripts work, and stopping preserves the named volume. The container is running for Part 2 review.

Success criteria: A user can start the container locally, load the example page, see its successful API call, and stop the container with the platform script.

## Part 3: Serve the demo Kanban

- [x] Configure Next.js for static export and extend the Docker build with a frontend build stage that places the exported assets where FastAPI serves them at `/`.
- [x] Replace the example page with the existing Kanban demo while preserving its five fixed columns, rename, add/delete, and drag-and-drop interactions.
- [x] Add card title/details editing, which the current demo does not yet support; keep the UI consistent with the defined color scheme.
- [x] Ensure frontend routes and assets resolve correctly from FastAPI and that `/api` routes do not collide with static paths.
- [x] Adapt the existing Vitest and Playwright setup to test the container-served site where appropriate.

Tests:

- [x] Frontend unit/component tests cover rename, add, edit, delete, and move, including same-column reorder and cross-column move.
- [x] Browser test against the container-served site checks the board, static assets, and the key interactions.
- [x] Frontend production build and lint pass.

Part 3 validation: seven frontend unit tests, four container-based browser tests, and the backend route/static-asset test pass. The production build and lint pass. Focused frontend unit coverage is 88.69% of board components and logic; backend routing coverage is 100%. The board remains local-only and resets on refresh. The dependency audit flags six advisories in production-labeled frontend dependencies; Next.js is used in the Docker build stage, not as the runtime server. Dependency remediation remains separate from this part's functionality.

Success criteria: The real demo board works at the container's `/` route and has all required local-only card interactions; no backend persistence is claimed yet.

## Part 4: Dummy sign-in and sign-out

- [x] Add a simple sign-in screen shown before the board; accept only the MVP credentials `user` / `password`.
- [x] Validate credentials in FastAPI and issue a backend-managed, HTTP-only session cookie; never use a frontend-only login flag as authorization.
- [x] Add a session-status endpoint and logout endpoint; restore the signed-in state after page refresh until logout or session expiry.
- [x] Guard the board and protected API routes, and provide a clear invalid-credentials response without exposing the password.

Tests:

- [x] Backend tests cover valid/invalid login, session status, logout, expired or missing sessions, and protection of private endpoints.
- [x] Browser tests cover initial login screen, rejected login, successful login, refresh, logout, and return to the login screen.

Part 4 validation: Five backend tests pass with 100% routing/auth coverage; nine frontend unit tests pass with 89.26% focused board/auth-shell coverage; five browser tests pass against the container. Frontend build and lint pass. The exported HTML contains no board content before the backend session check. Sessions are kept in memory for this stage, so a container restart signs users out.

Success criteria: A visitor cannot see the board before login; `user` / `password` grants access through a backend session, and logout revokes it.

## Part 5: Database model and approval

- [x] Propose a JSON schema description in `docs/` for users, one board per user, five ordered/renamable columns per board, and ordered cards with title/details and column membership.
- [x] Specify keys, relationships, uniqueness and ordering constraints, deletion behavior, and how the default board is initialized for a new user.
- [x] Document the SQLite file location on the Docker volume, initialization approach, and how user scoping will work despite only one hardcoded login in the MVP.
- [x] Review the proposal with the user and obtain explicit schema sign-off before implementing it.

Tests and review:

- [x] Walk through JSON examples for an empty board, renaming a column, and moving a card; verify all can be represented without changing the fixed column count.
- [x] Check that the model supports multiple users without exposing one user's board to another.

Part 5 proposal: [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) defines the SQLite tables and ownership rules; [board.schema.json](./board.schema.json) defines the board response and four example states. The examples parse and retain five columns, and the proposed DDL executes in an in-memory SQLite database. Uniqueness and cross-board foreign-key checks reject invalid rows. The user explicitly approved the schema before Part 6.

Success criteria: The proposed schema and database approach are documented in `docs/`, cover the required board operations, and are approved by the user.

## Part 6: Persistent board API

- [x] Implement the approved SQLite schema and automatic database creation/initialization when the file is absent.
- [x] Create the MVP user's single board and its five fixed columns on first use; keep IDs stable and prohibit adding or deleting columns.
- [x] Add authenticated API operations to read the board, rename a column, create/edit/delete a card, and move/reorder a card.
- [x] Validate request data and ownership on every operation; return clear responses for invalid IDs and unauthenticated requests.
- [x] Make card moves atomic so a card cannot be lost or duplicated between columns.

Tests:

- [x] Backend unit/integration tests cover initial creation, repeated startup without duplicate data, every CRUD/move operation, ordering, invalid input, and missing IDs.
- [x] Tests verify one board per user and reject cross-user access using a second test user in the database.
- [x] Restart with the same mounted volume and verify the board remains; start with a fresh volume and verify initialization.

Part 6 validation: Nine backend tests pass with 100% coverage of the backend application modules. A temporary card persisted through a Docker container restart on the mounted volume and was then deleted. An isolated fresh Docker volume produced a new SQLite database; that temporary volume was removed. The frontend still uses local demo state until Part 7.

Success criteria: All board changes are made through authenticated APIs and survive process/container restart, while each user's data remains isolated.

## Part 7: Connect frontend and backend

- [x] Load the signed-in user's board from the API instead of `initialData`; use demo data only for development/tests where explicitly needed.
- [x] Persist rename, add, edit, delete, drag-and-drop move, and same-column reorder through the API.
- [x] Handle loading, request failure, and session expiry simply, showing the user when a change did not save rather than silently leaving incorrect local state.
- [x] Keep one board per user and the five-column constraint visible in the UI.

Tests:

- [x] Frontend tests cover API loading, successful mutations, failed mutations, and expired sessions.
- [x] Browser end-to-end tests against the running app cover login, all board actions, refresh, and the rebuilt container deployment using the same SQLite volume.
- [x] Run backend tests, frontend unit tests, lint, production build, and browser tests together.

Part 7 validation: 14 frontend unit tests, nine backend tests, six deployed-container browser tests, frontend lint, and the production build pass. The Docker image was rebuilt and restarted with the existing SQLite volume; board actions persist through refresh and the deployed drag-and-drop move and same-column reorder flows pass. Vitest configuration now resolves the source alias with ESM-safe URL paths, avoiding the OneDrive/runner path issue.

Success criteria: The board shown after login reflects SQLite state, and every supported UI change persists after refresh and restart.

## Part 8: OpenRouter connectivity

- [x] Add a backend-only OpenRouter client using `OPENROUTER_API_KEY` from the root `.env` at runtime and model `openai/gpt-oss-120b`.
- [x] Add a minimal authenticated AI endpoint or diagnostic path that sends `2+2` and returns the model's answer; never expose the key to the frontend or logs.
- [x] Document the key requirement and a concise way to run the connectivity check.

Tests:

- [x] Mocked backend tests cover the request shape, response handling, missing key, and provider error.
- [x] With a configured key, run one real `2+2` request and confirm a successful provider response; report clearly if external connectivity or credentials prevent this check.

Success criteria: The backend successfully calls the specified OpenRouter model and receives a usable answer; no browser code contains the key.

Part 8 validation: 12 backend tests pass, the real OpenRouter check succeeds, and the deployed authenticated endpoint returns a successful `2+2` response. The API key remains server-side through Compose runtime environment injection.

## Part 9: Structured AI board actions

- [x] Extend the authenticated AI request to include the current user's board JSON, current message, and conversation history.
- [x] Define a Structured Outputs schema containing a user-facing reply and optional explicit card actions (create, edit, move; allow multiple actions in one response).
- [x] Validate the model output and every requested action against the authenticated user's board before applying updates; apply a valid batch transactionally.
- [x] Return the reply and the updated board (or a clear indication that nothing changed) to the frontend; reject malformed or invalid actions without partial updates.

Tests:

- [x] Mocked tests verify board and history are sent, a reply-only response changes nothing, and one or multiple card actions produce the expected ordered board.
- [x] Tests cover unknown cards/columns, malformed Structured Outputs, invalid batches, provider errors, and user isolation.
- [x] Run a bounded real-model check with a read-only question and a card-change request if the OpenRouter key is available.

Success criteria: AI replies are schema-valid, optional card changes are applied only through validated backend operations, and an invalid response cannot partially corrupt a board.

Part 9 validation: 18 backend tests pass with no diagnostics. The real model returned a reply-only response with no actions for a read-only question and a valid create action for an explicit card-change request; the returned action was inspected without applying it. SQLite batch validation and rollback protection are covered by the mocked endpoint tests.

## Part 10: AI chat sidebar and final integration

- [x] Add a responsive, accessible chat sidebar matching the app's colors and visual style, with message history, input, send/loading state, and clear error feedback.
- [x] Send the user's message and conversation history to the authenticated AI endpoint; display the returned reply.
- [x] When the AI changes cards, refresh the board from the backend automatically without requiring a page reload.
- [x] Keep chat usable alongside board interactions and ensure logout removes the previous session's visible chat history.
- [x] Update minimal user-facing run instructions and any relevant `AGENTS.md` descriptions to match the completed app.

Tests:

- [x] Component tests cover message submission, reply rendering, loading/error states, and board refresh after AI actions.
- [x] Browser tests cover login, chat with a mocked provider reply, AI-created/edited/moved cards, persistence after refresh, and logout.
- [x] Run the complete backend and frontend test suites, lint, production build, and container smoke test; perform one real OpenRouter chat check when configured.
- [x] Review backend and frontend coverage against the approximately 80% goal, documenting any justified gaps rather than padding the suites.

Success criteria: A signed-in user can chat with the AI, see one or more AI-requested card changes appear immediately and persist, and use the full app locally through the supplied container scripts.

Part 10 validation: 18 backend tests, 19 frontend unit tests, and seven deployed-container browser tests pass. Frontend lint, production build, and backend diagnostics pass. Coverage is 96% backend and 89.36% frontend statements; the remaining gaps are mostly untested defensive/error branches and the drag-overlay presentation component, documented by the coverage report rather than padded with low-value tests. A live authenticated read-only chat check returned HTTP 200 with a reply-only response.

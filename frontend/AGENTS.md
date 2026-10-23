# Frontend code map

This is the Kanban Studio board. It uses Next.js App Router with static export, React, TypeScript, Tailwind CSS, and `@dnd-kit`. Read the root `AGENTS.md` and [`docs/PLAN.md`](../docs/PLAN.md) for the product requirements and staged work.

## Current structure

- `src/app/page.tsx` renders `AppShell`, which checks the backend session and shows sign-in before the board; `layout.tsx` sets metadata; `globals.css` defines the shared color variables.
- `src/lib/kanban.ts` defines `Card`, `Column`, and `BoardData`, seeds five columns and example cards, and implements `moveCard` and client-side ID creation.
- `src/components/KanbanBoard.tsx` owns board loading and persistence-backed mutations, including column renaming, card add/edit/delete, drag-and-drop moves, and refresh signals from AI actions.
- `src/components/ChatSidebar.tsx` sends authenticated structured AI requests, displays the conversation, and signals the board to refresh after card actions.
- `src/components/KanbanColumn.tsx`, `KanbanCard.tsx`, `KanbanCardPreview.tsx`, and `NewCardForm.tsx` render the columns, cards, drag preview, and add-card form.
- `next.config.ts` enables static export. Docker copies the export into FastAPI's static directory. Sign-in, board persistence, and the AI chat sidebar use the backend session and API.

## Existing checks

From `frontend/`:

- `npm run test:unit` runs Vitest component and board-logic tests in `src/`.
- `npm run test:e2e` runs Playwright tests in `tests/` against the container at `127.0.0.1:8000` by default; set `PLAYWRIGHT_BASE_URL` to override.
- `npm run lint` runs ESLint; `npm run build` runs the production Next.js build.

Keep this map aligned with the code as the staged implementation changes it.

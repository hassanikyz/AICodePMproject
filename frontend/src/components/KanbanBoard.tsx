"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  pointerWithin,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { moveCard, type BoardData } from "@/lib/kanban";
import { boardRequest, SessionExpired } from "@/lib/boardApi";

export const KanbanBoard = ({ onSessionExpired, refreshSignal = 0 }: { onSessionExpired: () => void; refreshSignal?: number }) => {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    boardRequest("/api/board")
      .then((loaded) => {
        if (!active) return;
        setBoard(loaded);
        setError("");
      })
      .catch((failure) => {
        if (!active) return;
        if (failure instanceof SessionExpired) onSessionExpired();
        else setError("Could not load your board. Try again.");
      });
    return () => { active = false; };
  }, [onSessionExpired, refreshSignal, attempt]);

  const save = async (path: string, method: string, data?: object): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    setError("");
    try {
      setBoard(await boardRequest(path, method, data));
      return true;
    } catch (failure) {
      if (failure instanceof SessionExpired) onSessionExpired();
      else setError("Change was not saved. Try again.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const cardIdFromDragId = (id: string) => id.startsWith("card-") ? id.slice(5) : id;
  const boardIdFromDragId = (id: string) => id.startsWith("column-") ? id.slice(7) : cardIdFromDragId(id);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(cardIdFromDragId(String(event.active.id)));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!board || !over || active.id === over.id) {
      return;
    }
    const activeId = cardIdFromDragId(String(active.id));
    const overId = String(over.id).startsWith("column-")
      ? `column:${boardIdFromDragId(String(over.id))}`
      : `card:${boardIdFromDragId(String(over.id))}`;
    const columns = moveCard(board.columns, activeId, overId);
    const target = columns.find((column) => column.cardIds.includes(activeId));
    const position = target?.cardIds.indexOf(activeId);
    if (!target || position === undefined || columns === board.columns) return;
    void save(`/api/cards/${activeId}/move`, "POST", { column_id: Number(target.id), position });
  };

  const handleRenameColumn = (columnId: string, title: string) =>
    save(`/api/columns/${columnId}`, "PATCH", { title });

  const handleAddCard = (columnId: string, title: string, details: string) =>
    save("/api/cards", "POST", { column_id: Number(columnId), title, details });

  const handleDeleteCard = (cardId: string) => save(`/api/cards/${cardId}`, "DELETE");

  const handleEditCard = (cardId: string, title: string, details: string) =>
    save(`/api/cards/${cardId}`, "PATCH", { title, details });

  const activeCard = activeCardId && board ? board.cards[activeCardId] : null;

  if (!board) return (
    <main className="mx-auto max-w-[1500px] px-6 py-12">
      {error ? <><p role="alert">{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></> : <p role="status">Loading board...</p>}
    </main>
  );

  const collisionDetectionStrategy = (args: Parameters<typeof closestCenter>[0]) => {
    const pointerMatches = pointerWithin(args);
    return pointerMatches.length > 0 ? pointerMatches : closestCenter(args);
  };

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1500px] flex-col gap-10 px-6 pb-16 pt-12">
        {error && <p role="alert" className="rounded-xl bg-white p-4 text-red-700">{error}</p>}
        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                Focus
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                One board. Five columns. Zero clutter.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {board.columns.map((column) => (
              <div
                key={column.id}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                {column.title}
              </div>
            ))}
          </div>
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetectionStrategy}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <section className="grid min-w-0 gap-6 overflow-x-auto pb-4 lg:grid-cols-[repeat(5,minmax(260px,1fr))]">
            {board.columns.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                cards={column.cardIds.map((cardId) => board.cards[cardId])}
                onRename={handleRenameColumn}
                onAddCard={handleAddCard}
                onEditCard={handleEditCard}
                onDeleteCard={handleDeleteCard}
              />
            ))}
          </section>
          <DragOverlay>
            {activeCard ? (
              <div className="w-[260px]">
                <KanbanCardPreview card={activeCard} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>
    </div>
  );
};

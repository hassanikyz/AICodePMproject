import { useState, type FormEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import type { Card } from "@/lib/kanban";

type KanbanCardProps = {
  card: Card;
  onEdit: (cardId: string, title: string, details: string) => Promise<boolean>;
  onDelete: (cardId: string) => Promise<boolean>;
};

export const KanbanCard = ({ card, onEdit, onDelete }: KanbanCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [details, setDetails] = useState(card.details);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `card-${card.id}` });

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) return;
    if (await onEdit(card.id, title.trim(), details.trim())) setIsEditing(false);
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        "min-w-0 rounded-2xl border border-transparent bg-white px-4 py-4 shadow-[0_12px_24px_rgba(3,33,71,0.08)]",
        "transition-all duration-150",
        isDragging && "opacity-60 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
      data-testid={`card-${card.id}`}
    >
      {isEditing ? (
        <form onSubmit={(event) => void saveEdit(event)} className="space-y-3">
          <input
            aria-label="Edit card title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-xl border border-[var(--stroke)] px-3 py-2 text-sm text-[var(--navy-dark)]"
            required
          />
          <textarea
            aria-label="Edit card details"
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            rows={3}
            className="w-full rounded-xl border border-[var(--stroke)] px-3 py-2 text-sm text-[var(--navy-dark)]"
          />
          <div className="flex gap-2">
            <button type="submit" className="rounded-full bg-[var(--secondary-purple)] px-3 py-2 text-xs font-semibold text-white">Save</button>
            <button type="button" onClick={() => setIsEditing(false)} className="rounded-full border border-[var(--stroke)] px-3 py-2 text-xs">Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="break-words font-display text-base font-semibold text-[var(--navy-dark)]">{card.title}</h4>
            <p className="mt-2 break-words text-sm leading-6 text-[var(--gray-text)]">{card.details}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button type="button" {...attributes} {...listeners} aria-label={`Drag ${card.title}`} className="rounded-full px-2 py-1 text-xs text-[var(--gray-text)]">Move</button>
            <button type="button" onClick={() => { setTitle(card.title); setDetails(card.details); setIsEditing(true); }} aria-label={`Edit ${card.title}`} className="rounded-full px-2 py-1 text-xs text-[var(--primary-blue)]">Edit</button>
            <button type="button" onClick={() => void onDelete(card.id)} aria-label={`Delete ${card.title}`} className="rounded-full px-2 py-1 text-xs text-[var(--gray-text)]">Remove</button>
          </div>
        </div>
      )}
    </article>
  );
};

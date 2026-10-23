import type { BoardData } from "@/lib/kanban";

type ApiCard = { id: number; title: string; details: string; position: number };
type ApiColumn = { id: number; title: string; position: number; cards: ApiCard[] };
type ApiBoard = { id: number; columns: ApiColumn[] };

export class SessionExpired extends Error {}

export const toBoardData = (board: ApiBoard): BoardData => {
  if (board.columns.length !== 5) throw new Error("Expected five board columns");
  const columns = [...board.columns].sort((a, b) => a.position - b.position);
  return {
    columns: columns.map((column) => ({
      id: String(column.id),
      title: column.title,
      cardIds: [...column.cards].sort((a, b) => a.position - b.position).map((card) => String(card.id)),
    })),
    cards: Object.fromEntries(columns.flatMap((column) => column.cards.map((card) => [
      String(card.id),
      { id: String(card.id), title: card.title, details: card.details },
    ]))),
  };
};

export const boardRequest = async (path: string, method = "GET", data?: object): Promise<BoardData> => {
  const response = await fetch(path, {
    method,
    ...(data && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  });
  if (response.status === 401) throw new SessionExpired("Session expired");
  if (!response.ok) throw new Error("Board request failed");
  return toBoardData(await response.json() as ApiBoard);
};

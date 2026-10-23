export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatAction = {
  action: "create" | "edit" | "move";
  card_id?: number;
  column_id?: number;
  position?: number | null;
  title?: string;
  details?: string;
};
export type ChatReply = { reply: string; actions: ChatAction[] };

export const sendChatMessage = async (
  message: string,
  history: ChatMessage[],
): Promise<ChatReply> => {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (response.status === 401) throw new Error("Session expired");
  if (!response.ok) throw new Error("AI request failed");
  return await response.json() as ChatReply;
};

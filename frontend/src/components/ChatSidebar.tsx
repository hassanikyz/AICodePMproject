"use client";

import { useState, type FormEvent } from "react";
import { sendChatMessage, type ChatMessage } from "@/lib/aiApi";

type ChatSidebarProps = { onBoardChanged: () => void };

export const ChatSidebar = ({ onBoardChanged }: ChatSidebarProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setError("");
    setDraft("");
    const history = messages.slice(-20);
    setMessages((current) => [...current, { role: "user", content: message }]);
    try {
      const result = await sendChatMessage(message, history);
      setMessages((current) => [...current, { role: "assistant", content: result.reply }]);
      if (result.actions.length > 0) onBoardChanged();
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "Session expired"
        ? "Your session expired. Sign in again."
        : "The AI request failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside aria-label="AI assistant" className="flex w-full shrink-0 flex-col rounded-[28px] border border-[var(--stroke)] bg-white p-5 shadow-[var(--shadow)] lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:w-[340px]">
      <div className="border-b border-[var(--stroke)] pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--primary-blue)]">AI assistant</p>
        <h2 className="mt-2 font-display text-2xl font-semibold text-[var(--navy-dark)]">Plan the next move</h2>
        <p className="mt-2 text-sm leading-5 text-[var(--gray-text)]">Ask for a board summary or request card changes.</p>
      </div>
      <div aria-live="polite" className="flex min-h-[180px] flex-1 flex-col gap-3 overflow-y-auto py-4">
        {messages.length === 0 && <p className="rounded-2xl bg-[var(--surface)] p-3 text-sm text-[var(--gray-text)]">Try “Summarize my board” or “Create a card for the launch checklist.”</p>}
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-5 ${message.role === "user" ? "self-end bg-[var(--secondary-purple)] text-white" : "self-start bg-[var(--surface)] text-[var(--navy-dark)]"}`}>
            {message.content}
          </div>
        ))}
        {busy && <p role="status" className="text-sm text-[var(--gray-text)]">Thinking...</p>}
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
      <form onSubmit={submit} className="space-y-3 border-t border-[var(--stroke)] pt-4">
        <label htmlFor="ai-message" className="sr-only">Message the AI assistant</label>
        <textarea id="ai-message" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask the AI assistant..." rows={3} disabled={busy} className="w-full resize-none rounded-2xl border border-[var(--stroke)] px-3 py-2 text-sm outline-none focus:border-[var(--primary-blue)]" />
        <button type="submit" disabled={busy || !draft.trim()} className="w-full rounded-full bg-[var(--secondary-purple)] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? "Sending..." : "Send message"}
        </button>
      </form>
    </aside>
  );
};

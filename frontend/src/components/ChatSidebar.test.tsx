import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { ChatSidebar } from "@/components/ChatSidebar";

afterEach(() => vi.unstubAllGlobals());

it("submits a message, renders the reply, and refreshes after actions", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ reply: "Created it.", actions: [{ action: "create", column_id: 1, title: "New" }] }),
  });
  const onBoardChanged = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(<ChatSidebar onBoardChanged={onBoardChanged} />);

  await userEvent.type(screen.getByLabelText("Message the AI assistant"), "Create a card");
  await userEvent.click(screen.getByRole("button", { name: "Send message" }));

  expect(await screen.findByText("Created it.")).toBeInTheDocument();
  expect(onBoardChanged).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith("/api/ai/chat", expect.objectContaining({ method: "POST" }));
});

it("shows loading and error feedback", async () => {
  let resolveRequest: ((value: { ok: boolean; json: () => Promise<never> }) => void) | undefined;
  const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  render(<ChatSidebar onBoardChanged={vi.fn()} />);
  await userEvent.type(screen.getByLabelText("Message the AI assistant"), "Hello");
  await userEvent.click(screen.getByRole("button", { name: "Send message" }));
  expect(screen.getByRole("status")).toHaveTextContent("Thinking...");
  resolveRequest?.({ ok: false, json: async () => { throw new Error("unused"); } });
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The AI request failed. Try again."));
});

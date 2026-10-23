import { afterEach, vi } from "vitest";
import { sendChatMessage } from "@/lib/aiApi";

afterEach(() => vi.unstubAllGlobals());

it("sends the current message and conversation history", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ reply: "Done", actions: [] }),
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(sendChatMessage("Move it", [{ role: "user", content: "Earlier" }])).resolves.toEqual({ reply: "Done", actions: [] });
  expect(fetchMock).toHaveBeenCalledWith("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Move it", history: [{ role: "user", content: "Earlier" }] }),
  });
});

it("reports expired sessions", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
  await expect(sendChatMessage("Hello", [])).rejects.toThrow("Session expired");
});

import { afterEach, vi } from "vitest";
import { boardRequest, SessionExpired, toBoardData } from "@/lib/boardApi";
import { apiBoard, boardReply } from "@/test/board";

afterEach(() => vi.unstubAllGlobals());

it("maps numeric IDs and positions to the board view", () => {
  const response = structuredClone(apiBoard);
  response.columns.reverse();
  response.columns[4].cards.reverse();
  const board = toBoardData(response);
  expect(board.columns[0].id).toBe("1");
  expect(board.columns[0].cardIds).toEqual(["11", "12"]);
  expect(board.cards["11"].title).toBe("First task");
});

it("rejects a board without five columns", () => {
  expect(() => toBoardData({ id: 1, columns: [] })).toThrow("Expected five board columns");
});

it("passes mutation JSON and reports unauthorized requests", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(boardReply()).mockResolvedValueOnce({ ok: false, status: 401 });
  vi.stubGlobal("fetch", fetchMock);
  await boardRequest("/api/cards", "POST", { title: "Test" });
  expect(fetchMock).toHaveBeenCalledWith("/api/cards", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: '{"title":"Test"}',
  });
  await expect(boardRequest("/api/board")).rejects.toBeInstanceOf(SessionExpired);
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { KanbanBoard } from "@/components/KanbanBoard";
import { apiBoard, boardReply } from "@/test/board";

afterEach(() => vi.unstubAllGlobals());

const setup = async (replies: unknown[] = []) => {
  const fetchMock = vi.fn().mockResolvedValueOnce(boardReply());
  for (const reply of replies) fetchMock.mockResolvedValueOnce(reply);
  vi.stubGlobal("fetch", fetchMock);
  const onSessionExpired = vi.fn();
  render(<KanbanBoard onSessionExpired={onSessionExpired} />);
  expect(await screen.findByText("First task")).toBeInTheDocument();
  return { fetchMock, onSessionExpired };
};

const firstColumn = () => screen.getByTestId("column-1");

it("loads the five server columns and their cards", async () => {
  await setup();
  expect(screen.getAllByTestId(/column-\d+$/)).toHaveLength(5);
  expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
});

it("saves a column rename on blur", async () => {
  const renamed = structuredClone(apiBoard);
  renamed.columns[0].title = "Ideas";
  const { fetchMock } = await setup([boardReply(renamed)]);
  const input = within(firstColumn()).getByLabelText("Column title");
  await userEvent.clear(input);
  await userEvent.type(input, "Ideas");
  await userEvent.tab();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/columns/1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ title: "Ideas" }) })));
  expect(input).toHaveValue("Ideas");
});

it("creates, edits and deletes a card using server responses", async () => {
  const added = structuredClone(apiBoard);
  added.columns[0].cards.push({ id: 13, title: "New card", details: "Notes", position: 2 });
  const edited = structuredClone(added);
  edited.columns[0].cards[2].title = "Updated card";
  edited.columns[0].cards[2].details = "Updated notes";
  const { fetchMock } = await setup([boardReply(added), boardReply(edited), boardReply(apiBoard)]);
  await userEvent.click(within(firstColumn()).getByRole("button", { name: /add a card/i }));
  await userEvent.type(within(firstColumn()).getByPlaceholderText("Card title"), "New card");
  await userEvent.type(within(firstColumn()).getByPlaceholderText("Details"), "Notes");
  await userEvent.click(within(firstColumn()).getByRole("button", { name: "Add card" }));
  const card = await screen.findByTestId("card-13");
  expect(fetchMock).toHaveBeenCalledWith("/api/cards", expect.objectContaining({ method: "POST" }));
  await userEvent.click(within(card).getByRole("button", { name: "Edit New card" }));
  await userEvent.clear(within(card).getByRole("textbox", { name: "Edit card title" }));
  await userEvent.type(within(card).getByRole("textbox", { name: "Edit card title" }), "Updated card");
  await userEvent.clear(within(card).getByRole("textbox", { name: "Edit card details" }));
  await userEvent.type(within(card).getByRole("textbox", { name: "Edit card details" }), "Updated notes");
  await userEvent.click(within(card).getByRole("button", { name: "Save" }));
  expect(await within(card).findByText("Updated card")).toBeInTheDocument();
  await userEvent.click(within(card).getByRole("button", { name: "Delete Updated card" }));
  await waitFor(() => expect(screen.queryByTestId("card-13")).not.toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledWith("/api/cards/13", expect.objectContaining({ method: "DELETE" }));
});

it("keeps failed additions open and unchanged, with an error", async () => {
  await setup([{ ok: false, status: 500 }]);
  await userEvent.click(within(firstColumn()).getByRole("button", { name: /add a card/i }));
  await userEvent.type(within(firstColumn()).getByPlaceholderText("Card title"), "Unsaved");
  await userEvent.click(within(firstColumn()).getByRole("button", { name: "Add card" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Change was not saved");
  expect(within(firstColumn()).getByPlaceholderText("Card title")).toHaveValue("Unsaved");
  expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
});

it("shows a load failure and retries", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValueOnce(boardReply());
  vi.stubGlobal("fetch", fetchMock);
  render(<KanbanBoard onSessionExpired={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your board");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("First task")).toBeInTheDocument();
});

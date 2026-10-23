import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import { boardReply } from "@/test/board";

afterEach(() => vi.unstubAllGlobals());

const sessionReply = (authenticated: boolean) => ({ ok: true, json: async () => ({ authenticated }) });

it("checks the session and loads the saved board before showing it", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(sessionReply(true)).mockResolvedValueOnce(boardReply());
  vi.stubGlobal("fetch", fetchMock);
  render(<AppShell />);
  expect(screen.queryByText("First task")).not.toBeInTheDocument();
  expect(await screen.findByText("First task")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/session");
  expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/board", { method: "GET" });
});

it("rejects bad credentials, then signs in and out", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(sessionReply(false))
    .mockResolvedValueOnce({ ok: false, status: 401 })
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce(boardReply())
    .mockResolvedValueOnce({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  render(<AppShell />);
  await screen.findByRole("heading", { name: "Sign in" });
  await userEvent.type(screen.getByLabelText("Username"), "user");
  await userEvent.type(screen.getByLabelText("Password"), "wrong");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid username or password.");

  await userEvent.clear(screen.getByLabelText("Password"));
  await userEvent.type(screen.getByLabelText("Password"), "password");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("First task")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument());
});

it("returns to sign-in when the board session has expired", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(sessionReply(true))
    .mockResolvedValueOnce({ ok: false, status: 401 }));
  render(<AppShell />);
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Session expired. Sign in again.");
});

it("refreshes the board when chat reports card actions", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(sessionReply(true))
    .mockResolvedValueOnce(boardReply())
    .mockResolvedValueOnce({ ok: true, json: async () => ({ reply: "Created", actions: [{ action: "create" }] }) })
    .mockResolvedValueOnce(boardReply());
  vi.stubGlobal("fetch", fetchMock);
  render(<AppShell />);
  await screen.findByText("First task");
  await userEvent.type(screen.getByLabelText("Message the AI assistant"), "Create a card");
  await userEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Created");
  await waitFor(() => expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/board", { method: "GET" }));
});

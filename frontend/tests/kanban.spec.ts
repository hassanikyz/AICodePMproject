import { expect, test, type Page } from "@playwright/test";

const signIn = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
};

test("requires login and restores the session until logout", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(0);
  expect((await page.request.get("/api/hello")).status()).toBe(401);

  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid username or password.")).toBeVisible();
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  expect((await page.request.get("/api/hello")).status()).toBe(200);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect((await page.request.get("/api/hello")).status()).toBe(401);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("loads the kanban board", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
  const assets = await page.locator('script[src^="/_next/"]').count();
  expect(assets).toBeGreaterThan(0);
});

test("creates, edits and deletes a card with persistence after refresh", async ({ page }) => {
  await signIn(page);
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  const title = `Playwright card ${Date.now()}`;
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill(title);
  await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText(title)).toBeVisible();
  const card = firstColumn.locator('[data-testid^="card-"]', { hasText: title });
  const cardId = (await card.getAttribute("data-testid"))?.replace("card-", "");
  if (!cardId) throw new Error("New card ID missing");
  try {
    await page.reload();
    await expect(page.getByTestId(`card-${cardId}`)).toContainText(title);
    const saved = page.getByTestId(`card-${cardId}`);
    await saved.getByRole("button", { name: `Edit ${title}` }).click();
    await saved.getByRole("textbox", { name: "Edit card title" }).fill("Edited card");
    await saved.getByRole("textbox", { name: "Edit card details" }).fill("Edited details");
    await saved.getByRole("button", { name: "Save" }).click();
    await expect(saved.getByText("Edited card")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId(`card-${cardId}`)).toContainText("Edited details");
    await page.getByTestId(`card-${cardId}`).getByRole("button", { name: "Delete Edited card" }).click();
    await expect(page.getByTestId(`card-${cardId}`)).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId(`card-${cardId}`)).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/cards/${cardId}`);
  }
});

test("moves a card between columns", async ({ page }) => {
  await signIn(page);
  const board = await (await page.request.get("/api/board")).json();
  const sourceId = board.columns[0].id;
  const targetId = board.columns[3].id;
  const title = `Move probe ${Date.now()}`;
  const created = await (await page.request.post("/api/cards", { data: { column_id: sourceId, title } })).json();
  const cardId = created.columns[0].cards.find((item: { title: string }) => item.title === title).id;
  await page.reload();
  const card = page.getByTestId(`card-${cardId}`);
  const targetColumn = page.getByTestId(`column-${targetId}`);
  const handle = card.getByRole("button", { name: `Drag ${title}` });
  await targetColumn.scrollIntoViewIfNeeded();
  await handle.scrollIntoViewIfNeeded();
  const cardBox = await handle.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  try {
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(columnBox.x + columnBox.width / 2, cardBox.y + cardBox.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(targetColumn.getByTestId(`card-${cardId}`)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId(`column-${targetId}`).getByTestId(`card-${cardId}`)).toBeVisible();
  } finally {
    await page.request.delete(`/api/cards/${cardId}`);
  }
});

test("reorders cards in one column and preserves the order", async ({ page }) => {
  await signIn(page);
  const board = await (await page.request.get("/api/board")).json();
  const columnId = board.columns[0].id;
  const firstTitle = `Order first ${Date.now()}`;
  const secondTitle = `Order second ${Date.now()}`;
  const first = await (await page.request.post("/api/cards", { data: { column_id: columnId, title: firstTitle } })).json();
  const firstId = first.columns[0].cards.find((item: { title: string }) => item.title === firstTitle).id;
  const second = await (await page.request.post("/api/cards", { data: { column_id: columnId, title: secondTitle } })).json();
  const secondId = second.columns[0].cards.find((item: { title: string }) => item.title === secondTitle).id;
  try {
    await page.reload();
    const targetCard = page.getByTestId(`card-${secondId}`);
    const moveResponse = page.waitForResponse((response) => response.url().endsWith(`/api/cards/${firstId}/move`), { timeout: 10000 });
    const handle = page.getByTestId(`card-${firstId}`).getByRole("button", { name: `Drag ${firstTitle}` });
    await handle.scrollIntoViewIfNeeded();
    const from = await handle.boundingBox();
    const to = await targetCard.boundingBox();
    if (!from || !to) throw new Error("Unable to resolve drag coordinates.");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
    expect((await moveResponse).status()).toBe(200);
    await page.reload();
    const ids = await page.getByTestId(`column-${columnId}`).locator('[data-testid^="card-"]').evaluateAll((cards) => cards.map((card) => card.getAttribute("data-testid")));
    expect(ids.indexOf(`card-${secondId}`)).toBeLessThan(ids.indexOf(`card-${firstId}`));
  } finally {
    await page.request.delete(`/api/cards/${firstId}`);
    await page.request.delete(`/api/cards/${secondId}`);
  }
});

test("renames a column and keeps the title after refresh", async ({ page }) => {
  await signIn(page);
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  const id = (await firstColumn.getAttribute("data-testid"))?.replace("column-", "");
  if (!id) throw new Error("Column ID missing");
  const input = firstColumn.getByRole("textbox", { name: "Column title" });
  const original = await input.inputValue();
  try {
    await input.fill("Ideas");
    await input.press("Tab");
    await expect(input).toHaveValue("Ideas");
    await page.reload();
    await expect(page.getByTestId(`column-${id}`).getByRole("textbox", { name: "Column title" })).toHaveValue("Ideas");
  } finally {
    await page.request.patch(`/api/columns/${id}`, { data: { title: original } });
  }
});

type BrowserCard = { id: number; title: string; details: string; position: number };
type BrowserBoard = { columns: Array<{ id: number; cards: BrowserCard[] }> };

test("chat creates, edits, moves, persists, and clears history on logout", async ({ page }) => {
  let boardState: BrowserBoard;
  await page.route("**/api/board", async (route) => {
    if (!boardState) {
      boardState = await (await route.fetch()).json();
    }
    await route.fulfill({ json: boardState });
  });
  await page.route("**/api/ai/chat", async (route) => {
    const request = route.request().postDataJSON() as { message: string };
    const backlog = boardState.columns[0];
    const done = boardState.columns[4];
    let action: Record<string, unknown>;
    if (request.message.includes("create")) {
      const card = { id: 910000, title: "AI created", details: "AI details", position: 0 };
      backlog.cards.unshift(card);
      backlog.cards.forEach((item: { position: number }, index: number) => { item.position = index; });
      action = { action: "create", title: card.title, details: card.details, column_id: backlog.id, position: 0 };
    } else if (request.message.includes("edit")) {
      const card = backlog.cards.find((item: { title: string }) => item.title === "AI created")!;
      card.title = "AI edited";
      card.details = "Edited by AI";
      action = { action: "edit", card_id: card.id, title: card.title, details: card.details };
    } else {
      const card = backlog.cards.find((item: { title: string }) => item.title === "AI edited")!;
      backlog.cards = backlog.cards.filter((item: { id: number }) => item.id !== card.id);
      backlog.cards.forEach((item: { position: number }, index: number) => { item.position = index; });
      card.position = done.cards.length;
      done.cards.push(card);
      action = { action: "move", card_id: card.id, column_id: done.id, position: card.position };
    }
    await route.fulfill({ json: { reply: "AI updated the board.", actions: [action] } });
  });

  await signIn(page);
  const input = page.getByLabel("Message the AI assistant");
  await input.fill("create a launch card");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByTestId("card-910000")).toContainText("AI created");

  await input.fill("edit the launch card");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByTestId("card-910000")).toContainText("AI edited");

  await input.fill("move the launch card");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByTestId("column-5").getByTestId("card-910000")).toContainText("AI edited");
  await expect(page.getByText("AI updated the board.")).toHaveCount(3);
  await page.reload();
  await expect(page.getByTestId("column-5").getByTestId("card-910000")).toContainText("Edited by AI");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText("AI updated the board.")).toHaveCount(0);
});

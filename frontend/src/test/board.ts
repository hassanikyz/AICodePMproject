export const apiBoard = {
  id: 1,
  columns: [
    { id: 1, title: "Backlog", position: 0, cards: [
      { id: 11, title: "First task", details: "First notes", position: 0 },
      { id: 12, title: "Second task", details: "Second notes", position: 1 },
    ] },
    { id: 2, title: "Discovery", position: 1, cards: [] },
    { id: 3, title: "In Progress", position: 2, cards: [] },
    { id: 4, title: "Review", position: 3, cards: [] },
    { id: 5, title: "Done", position: 4, cards: [] },
  ],
};

export const boardReply = (board = apiBoard) => ({ ok: true, status: 200, json: async () => board });

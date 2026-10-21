# kanban

To move a card you need the board in front of you: its columns and their cards. That is one
document, `board:1`, over three tables in SQLite (`kanban_boards`, `kanban_columns`,
`kanban_cards`). Open it and you hold it: a card someone else moves, moves on your board too,
with nothing to fetch or refresh.

## What is here

The app is its routes and its resources, as every app is (paintbrush's README, *Routes,
resources and documents*):

```
routes.ts              the app: the page and the socket, given to delta's serve; run, it is the server
index.html, index.css  the page
app.tsx                the socket every document rides, and the board's view on the page
resources/board/
  board-api.ts         the server side: the tables, the board:1 document, one board seeded
  board.ts             the client's handle: openDoc("board:1")
  board-view.tsx       the board on the page, drawn with railroad
run.ts                 two clients in the terminal, on the same server
```

## Run the page

```sh
bun examples/kanban/routes.ts                   # port 3100
PORT=3199 bun examples/kanban/routes.ts         # if 3100 is busy
```

Open <http://localhost:3100> in two tabs. Click a card and it moves to the next column in both.
Double-click a column title to rename it; "+ add card" adds one. Each is one op: `replace` for a
move or a rename, `add` for a card. Each run resets the board.

`routes.ts` is the server, and `board.ts` and `board-view.tsx` are the board on the page:

```tsx
// routes.ts: the document on the socket, the page beside it
const ws = createWs();
const db = boardApi(ws);
return serve({ ws, routes: { "/": index }, close: [() => db.close()] }, { port, dev });

// board.ts: board.data is a signal of the board
export const board = openDoc<BoardDoc>("board:1");

// board-view.tsx: a column's cards, keyed by id: a moved card re-renders, the rest stay
{list<Card>(cards$, (c: Card) => c.id, (c$) => <CardItem card$={c$} />)}

// a move is one op on one path
await board.send([{ op: "replace", path: `/kanban_cards/${card.id}/kanban_columns_id`, value: next.id }]);
```

## Run it in the terminal

```sh
bun run examples/kanban/run.ts
```

Alice and Bob open the board over two sockets. Alice renames a column, moves a card and adds
one in a single `send`; the script prints what Bob was told and his board after it. Then Charlie
opens the board late and gets the same.

`tests/examples.test.ts` runs both: two browsers on `routes.ts` (one clicks a card, both see it
move), and `run.ts`. The board lives in memory, fresh each run: a board kept in a file takes its
tables from its migrations, as `examples/lists` does. On Postgres the same schema and documents run on dzql (`dzql/postgres`).

## Left out

- Who may see a board: one person, no auth (`owns`: the delta-doc skill's `reference/ownership.md`).
- Drag and drop: a drop is the same `replace` as a click.

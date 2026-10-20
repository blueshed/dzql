# Realtime

## Your own patch stream: mutate in place, `.touch()`

```tsx
import { signal, list, mount } from "@blueshed/railroad";

type Row = { id: number; text: string; done: boolean };
const rows = signal<Row[]>([]);

const ws = new WebSocket("/ws");
ws.onmessage = (ev) => {
  const row: Row = JSON.parse(ev.data);
  const known = rows.peek().find((r) => r.id === row.id);
  if (known) Object.assign(known, row);          // in place: no clone of the whole document
  else rows.peek().push(row);
  rows.touch();                                  // notify, same reference
};

mount(document.getElementById("root")!, () => (
  <ul>
    {list(rows, (r) => r.id, (row$) => (
      <li>
        <input type="checkbox" checked={row$.map((r) => r.done)} />
        {row$.map((r) => r.text)}
      </li>
    ), { equals: () => false })}
  </ul>
));
```

- Don't `.set({ ...doc.peek(), … })` a fresh clone per patch on a large document: mutate it, then `.touch()`. `.mutate(fn)` (clone, mutate, notify) is the safer middle ground for small ones.
- `{ equals: () => false }` is needed because an in-place patch re-delivers the same row reference, which `Object.is` swallows; the row's own `.map()`s still bail on unchanged values, so DOM writes stay minimal.
- A projection that returns the same reference (`doc.map((d) => d.settings)`) bails after `.touch()`: project to fresh values or pass `{ equals: () => false }`.

## `@blueshed/delta`: documents over one WebSocket

```tsx
import { provide, list, when } from "@blueshed/railroad";
import { connectWs, WS, openDoc } from "@blueshed/delta/client";

provide(WS, connectWs("/ws"));
interface BoardDoc { cards: Record<string, { id: number; title: string }> }
const doc = openDoc<BoardDoc>("board:1");          // in a component or at module level

function Board() {
  const cards = doc.data.map((d) => d ? Object.values(d.cards) : []);
  return when(doc.data, () => (
    <ul>{list(cards, (c) => c.id, (card$) => <li>{card$.map((c) => c.title)}</li>)}</ul>
  ), () => <p>loading…</p>);
}

await doc.send([{ op: "add", path: "/cards/-", value: { title: "new card" } }]);   // the server names it
```

```ts
// server.ts: delta's one server hosts the page and the socket; the boards are kept in a JSON file
import home from "./index.html";
import { createWs } from "@blueshed/delta/server";
import { defineDoc, defineSchema, registerDocs } from "@blueshed/delta/json";
import { run, serve } from "@blueshed/delta/serve";

const schema = defineSchema({
  boards: { columns: { name: "text?" } },
  cards: { parent: "boards", columns: { title: "text" } },
});
const board = defineDoc("board:", { root: "boards", include: ["cards"], implied: true });

const ws = createWs();
registerDocs(ws, "./board.json", schema, [board]);
await run(() => serve({ ws, routes: { "/": home } }));
```

- `doc.data` is a railroad `ReadonlySignal<T | null>`: it drops into JSX, `when()` and `list()` with no glue. Change the document with `doc.send(ops)`, never `doc.data.set()`.
- Delta gives a changed row a fresh object, so `list()` keeps its default `equals`.
- Never `openDoc()` inside an `effect()` body unless following a signal is the intent: the doc closes when the effect re-runs.
- `applyOpsToCollection` (`@blueshed/delta/dom-ops`) is for vanilla DOM; with railroad, use `list()`. Pick one.
- Where documents are kept (a JSON file, SQLite, Postgres on dzql, memory, an outside source) changes nothing here: one client. The `delta-doc` skill, installed with delta, has them.
- Two copies of railroad break this silently: [one-copy](one-copy.md).

## dzql: an applet in a page the server draws

On a page dzql's server draws, the one piece with state of its own is an applet, and railroad can
draw it: `applet(render, reduce?)` from `dzql/rendering/applet`, its props a signal. How, with the
ticker's example, is dzql's `dzql-app` skill (`reference/applets.md`).

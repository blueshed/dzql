# The recipe: a chat room in a JSON file

`bun add @blueshed/delta @blueshed/railroad` (the client needs railroad), then these files.
No database to run, no fetch, no codegen. `tests/recipe.test.ts` runs them as written, so keep
the headings and blocks exact.

The app is its routes and its resources, as every app is: `routes.ts` gives delta's `serve` the
page and the socket, and the room is a resource, a folder of three files: `room-api.ts` the
document on the server, `room.ts` the client's handle to it, `room-view.tsx` its part of the page.
A second document is a second folder beside it.

### `routes.ts`

```ts
import index from "./index.html";
import { createWs } from "@blueshed/delta/server";
import { run, serve } from "@blueshed/delta/serve";
import { roomApi } from "./resources/room/room-api";

const ws = createWs();
roomApi(ws);   // the room's document, on the socket

await run(() => serve({ ws, routes: { "/": index } }, { port: 3100 }));
```

### `resources/room/room-api.ts`

```ts
import type { WsServer } from "@blueshed/delta/server";
import { defineDoc, defineSchema, registerDocs } from "@blueshed/delta/json";

// A room is a row; its messages hang under it (the key column rooms_id).
export const schema = defineSchema({
  rooms: { columns: { name: "text?" } },
  messages: { parent: "rooms", columns: { author: "text", text: "text", at: "text" } },
});

// What someone needs in front of them to chat: one room and its messages.
// `implied`: the room is made by its first write.
export const docs = [defineDoc("room:", { root: "rooms", include: ["messages"], implied: true })];

export interface Message { id: number; rooms_id: number; author: string; text: string; at: string }
export interface Room { rooms: { id: number; name: string | null }; messages: Record<string, Message> }

export function roomApi(ws: WsServer) {
  return registerDocs(ws, "./chat.json", schema, docs);   // where the documents are kept
}
```

### `resources/room/room.ts`

```ts
import { openDoc } from "@blueshed/delta/client";
import type { Room } from "./room-api";   // types only: no server code reaches the page

// The room: room.data follows every message anyone says; room.send says one.
export const room = openDoc<Room>("room:1");
```

### `resources/room/room-view.tsx`

```tsx
import { list } from "@blueshed/railroad";
import { room } from "./room";

// Send only: the op echoes back through the document and draws itself.
function say(e: SubmitEvent) {
  e.preventDefault();
  const input = (e.target as HTMLFormElement).elements.namedItem("text") as HTMLInputElement;
  if (input.value) room.send([{ op: "add", path: "/messages/-", value: { author: "me", text: input.value, at: new Date().toISOString() } }]); // a new row; the server names it
  input.value = "";
}

export function RoomView() {
  // The messages, in the order they were said: kept by the document, live ops and a reconnect's
  // whole replace alike. list() redraws only the rows that changed.
  const messages = room.data.map((r) => Object.values(r?.messages ?? {}).sort((a, b) => a.id - b.id));
  return (
    <>
      <div id="log">
        {list(messages, (m) => m.id, (m$) => <div><b>{m$.map((m) => m.author)}</b> <span>{m$.map((m) => m.text)}</span></div>)}
      </div>
      <form id="say" onsubmit={say}><input name="text" autocomplete="off" autofocus /> <button>Send</button></form>
    </>
  );
}
```

### `app.tsx`

```tsx
import { connectWs, WS } from "@blueshed/delta/client";
import { mount, provide } from "@blueshed/railroad";
import { RoomView } from "./resources/room/room-view";

provide(WS, connectWs("/ws"));   // one socket for every document the page opens

mount(document.getElementById("app")!, () => <RoomView />);
```

### `index.html`

```html
<!doctype html>
<div id="app"></div>
<script type="module" src="./app.tsx"></script>
```

### `tsconfig.json`

```json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@blueshed/railroad", "strict": true } }
```

`bun routes.ts` and open <http://localhost:3100> in two tabs. Bun's fullstack bundler handles
the TypeScript automatically.

**Moving to SQLite** changes `room-api.ts` and nothing else: its imports come from `@blueshed/delta/sqlite`, and `roomApi` opens `const db = new Database("chat.db")` (`bun:sqlite`), carries the rows once, into empty tables, with `createTables(db, schema); importTables(db, schema, exportTables(file, schema))`, and registers on it: `registerDocs(ws, db, schema, docs)`. `exportTables` alone is from `@blueshed/delta/json` (`file` is the JSON file). Ids carry, so the next message named follows on; `routes.ts`, the room's handle and view, and the page stay as they are.

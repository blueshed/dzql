# The recipe: a chat room in a JSON file

`bun add @blueshed/delta @blueshed/railroad` (the client needs railroad) and `bun add -d
@types/bun` (the tsconfig's `types`), then these files. No database to run, no fetch, no codegen. `tests/recipe.test.ts` runs them as written, so keep
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
  messages: { parent: "rooms", columns: { author: "text", text: "text", at: "timestamptz" } },
});

// What someone needs in front of them to chat: one room and its messages.
// `implied`: the room is made by its first write.
export const docs = [defineDoc("room:", { root: "rooms", include: ["messages"], implied: true })];

export interface Message { id: number; rooms_id: number; author: string; text: string; at: string }
export interface Room { rooms: { id: number; name: string | null }; messages: Record<string, Message> }

// Where the documents are kept: chat.json in `dir` (a test gives a folder of its own).
export function roomApi(ws: WsServer, dir = ".") {
  return registerDocs(ws, `${dir}/chat.json`, schema, docs);
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
        {list(messages, (m) => m.id, ({ author, text }) => <div><b>{author}</b> <span>{text}</span></div>)}
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
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "types": ["bun"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "esnext",
    "strict": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "jsxImportSource": "@blueshed/railroad"
  }
}
```

`bun routes.ts` and open <http://localhost:3100> in two tabs. Bun's fullstack bundler handles
the TypeScript automatically; `bun check` type-checks it.

## Its test

**An app keeps a test of its documents, and is not done until `bun test` passes**: two people
on a real server, one writes, the other is told (`testing.md`). `room.test.ts`, in the app's `tests/`:

```ts
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { connectWs, openDoc } from "@blueshed/delta/client";
import { createWs } from "@blueshed/delta/server";
import { serve } from "@blueshed/delta/serve";
import { waitFor } from "@blueshed/delta/testing";
import { roomApi, type Room } from "../resources/room/room-api";

test("what one person says, the other is told", async () => {
  const dir = mkdtempSync(`${tmpdir()}/room-`);   // a folder of its own, never the app's data
  const ws = createWs();
  await roomApi(ws, dir);
  const server = serve({ ws, routes: {} }, { port: 0, dev: false });
  const url = new URL(ws.path, server.url).href.replace("http", "ws");
  const ada = connectWs(url), bo = connectWs(url);   // two people, a socket each
  try {
    const says = openDoc<Room>("room:1", ada), hears = openDoc<Room>("room:1", bo);
    await Promise.all([says.ready, hears.ready]);
    await says.send([{ op: "add", path: "/messages/-", value: { author: "ada", text: "hello", at: new Date().toISOString() } }]);
    const told = await waitFor(() => Object.values(hears.data.get()?.messages ?? {}).find((m) => m.text === "hello"));
    expect(told).toMatchObject({ author: "ada", rooms_id: 1 });   // the room made by its first message
  } finally {
    ada.close(); bo.close();   // before the server stops, or they reconnect for ever
    await server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Working: `tests/recipe.test.ts` saves each block under a `###` heading at its path, starts the
server, and has a message typed in one browser show in the other's log; then saves this test in the
app's tests folder and runs it.

**Moving to SQLite** changes `room-api.ts`, and `routes.ts` awaits `roomApi`: the tables are made
by the room's migrations, written by `delta migrations make`, run before the documents register,
and the file's rows are carried in once. The whole of it is in `backends.md`. Ids carry, so the
next message named follows on; the room's handle and view, the page and its test stay as they are.

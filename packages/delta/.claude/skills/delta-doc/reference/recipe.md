# The recipe: a chat room in a JSON file

`bun add @blueshed/delta @blueshed/railroad` (the client needs railroad), then these five files.
No database to run, no fetch, no codegen. `tests/recipe.test.ts` runs them as written, so keep
the headings and blocks exact.

### `types.ts`

```ts
import { defineDoc, defineSchema } from "@blueshed/delta/json";

// A room is a row; its messages hang under it (the key column rooms_id).
export const schema = defineSchema({
  rooms: { columns: { name: "text?" } },
  messages: { parent: "rooms", columns: { author: "text", text: "text", at: "text" } },
});

// What someone needs in front of them to chat: one room and its messages.
// `implied`: the room is made by its first write.
export const room = defineDoc("room:", { root: "rooms", include: ["messages"], implied: true });

export interface Message { id: number; rooms_id: number; author: string; text: string; at: string }
export interface Room { rooms: { id: number; name: string | null }; messages: Record<string, Message> }
```

### `server.ts`

```ts
import index from "./index.html";
import { createWs } from "@blueshed/delta/server";
import { run, serve } from "@blueshed/delta/serve";
import { registerDocs } from "@blueshed/delta/json";
import { room, schema } from "./types";

const ws = createWs();
registerDocs(ws, "./chat.json", schema, [room]);   // where the documents are kept

await run(() => serve({ ws, routes: { "/": index } }, { port: 3100 }));
```

### `client.tsx`

```tsx
import { connectWs, openDoc } from "@blueshed/delta/client";
import { list, mount } from "@blueshed/railroad";
import type { Message, Room } from "./types";

const ws = connectWs("/ws");
const doc = openDoc<Room>("room:1", ws);

// The messages, in the order they were said: kept by the document, live ops and a reconnect's
// whole replace alike. list() redraws only the rows that changed.
const messages = doc.data.map((room) => Object.values(room?.messages ?? {}).sort((a, b) => a.id - b.id));

// Send only: the op echoes back through the document and draws itself.
function say(e: SubmitEvent) {
  e.preventDefault();
  const input = (e.target as HTMLFormElement).elements.namedItem("text") as HTMLInputElement;
  if (input.value) doc.send([{ op: "add", path: "/messages/-", value: { author: "me", text: input.value, at: new Date().toISOString() } }]); // a new row; the server names it
  input.value = "";
}

mount(document.getElementById("app")!, () => (
  <>
    <div id="log">
      {list(messages, (m) => m.id, (m$) => <div><b>{m$.map((m) => m.author)}</b> <span>{m$.map((m) => m.text)}</span></div>)}
    </div>
    <form id="say" onsubmit={say}><input name="text" autocomplete="off" autofocus /> <button>Send</button></form>
  </>
));
```

### `tsconfig.json`

```json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@blueshed/railroad", "strict": true } }
```

### `index.html`

```html
<!doctype html>
<div id="app"></div>
<script type="module" src="./client.tsx"></script>
```

Bun's fullstack bundler handles the TypeScript automatically.

**Moving to SQLite** changes `server.ts`'s wiring and nothing else: open `const db = new Database("chat.db")` (`bun:sqlite`), carry the rows once, into empty tables, with `createTables(db, schema); importTables(db, schema, exportTables(file, schema))`, and register on it: `registerDocs(ws, db, schema, [room])`. All from `@blueshed/delta/sqlite` but `exportTables`, from `@blueshed/delta/json` (`file` is the JSON file). Ids carry, so the next message named follows on; `types.ts`, `client.tsx` and the page stay as they are.


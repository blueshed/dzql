# A new document

A shared document, made the way `message` is: three files, then wired in. Its schema says what the rows are and its `defineDoc` what someone has in front of them; delta keeps them in a JSON file, and the same two definitions run on SQLite and Postgres. Notes show the other two verbs, `add` and `remove`. Its stories and tests are in [testing.md](testing.md).

```ts
// src/resources/notes/notes-api.ts
/** Notes: a shared document, its rows kept by delta in notes.json in the data folder. */
import type { WsServer } from "@blueshed/delta/server";
import { defineDoc, defineSchema, registerDocs } from "@blueshed/delta/json";

export type Note = { id: number; text: string };
export type Notes = { notes: Record<string, Note> };

export const schema = defineSchema({
  notes: { columns: { text: "text" }, temporal: false },
});

export const docs = [defineDoc("notes:", { root: "notes", include: [] })]; // every note

export function notesDoc(ws: WsServer, dataDir: string) {
  return registerDocs(ws, `${dataDir}/notes.json`, schema, docs);
}
```

```ts
// src/resources/notes/notes.ts
import { openDoc } from "@blueshed/delta/client";
import type { Notes } from "./notes-api";

/** The notes document: read-only, it follows every change. Change it with `notes.send(ops)`. */
export const notes = openDoc<Notes>("notes:");
```

```tsx
// src/resources/notes/notes-view.tsx
import { list, signal } from "@blueshed/railroad";
import { joinPath } from "@blueshed/delta/core";
import { Plus, Trash2 } from "lucide";
import { Icon } from "../icon";
import { toast } from "../toast";
import { notes } from "./notes";

export function NotesView() {
  const text = signal("");
  const all = notes.data.map((d) => Object.values(d?.notes ?? {}));

  // Send, and let the change that comes back draw it
  const add = () =>
    notes.send([{ op: "add", path: "/notes/-", value: { text: text.peek() } }]).then(
      () => text.set(""),
      () => toast("Not saved", "alert"),
    );
  const remove = (id: number) => notes.send([{ op: "remove", path: joinPath("notes", id) }]).catch(() => toast("Not saved", "alert"));

  return (
    <>
      <h1>Notes</h1>
      <ul class="notes">
        {list(all, (n) => n.id, (n$) => (
          <li>
            {n$.map((n) => n.text)}
            <button onclick={() => void remove(n$.peek().id)}>
              <Icon icon={Trash2} label="Remove" />
            </button>
          </li>
        ))}
      </ul>
      <input value={text} oninput={(e: Event) => text.set((e.currentTarget as HTMLInputElement).value)} />
      <div class="toolbar">
        <button class="primary" onclick={() => void add()}>
          <Icon icon={Plus} /> Add
        </button>
      </div>
    </>
  );
}
```

```ts
// src/routes.ts: after import { statusApi } from "./resources/status/status-api";
import { notesDoc } from "./resources/notes/notes-api";
```

```ts
// src/routes.ts: after await messageDoc(ws, dataDir);
await notesDoc(ws, dataDir);
```

```tsx
// src/app.tsx: after import { StatusView } from "./resources/status/status-view";
import { NotesView } from "./resources/notes/notes-view";
```

```tsx
// src/app.tsx: before "*": () => (
"/notes": () => <NotesView />,
```

- Never set a document in the page: `send` the change; it comes back to every window holding it, this one included, and draws there. Adding it locally as well draws it twice.
- A new row is `add /<collection>/-`: the server names it, in the path and as the row's `id`. Address a row by its id, never its position.
- Draw a collection with `list()`, keyed by id. Say "Not saved" when a `send` rejects.
- The schema says what a write may be: a field it does not declare, a value of the wrong type, a path outside the document, is refused with 400 and the reason, and nothing changes. An empty write writes nothing.
- Build a path from ids with `joinPath`, never a template.
- The page has one socket, in `src/app.tsx`; every document rides it, and it reconnects and reopens them itself.

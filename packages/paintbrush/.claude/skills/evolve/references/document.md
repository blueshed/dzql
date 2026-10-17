# A new document

A shared JSON document, made the way `message` is: three files, then wired in. Notes show the other two verbs, `add` and `remove`. Its tests are in [testing.md](testing.md).

```ts
// src/resources/notes/notes-api.ts
/** Notes: a shared document, kept by delta as notes.json in the data folder. */
import { registerDoc, type WsServer } from "@blueshed/delta/server";

export type Note = { id: string; text: string };
export type Notes = { notes: Record<string, Note> };

export function notesDoc(ws: WsServer, dataDir: string) {
  return registerDoc<Notes>(ws, "notes", { file: `${dataDir}/notes.json`, empty: { notes: {} } });
}
```

```ts
// src/resources/notes/notes.ts
import { openDoc } from "@blueshed/delta/client";
import type { Notes } from "./notes-api";

/** The notes document: read-only, it follows every change. Change it with `notes.send(ops)`. */
export const notes = openDoc<Notes>("notes");
```

```tsx
// src/resources/notes/notes-view.tsx
import { list, signal } from "@blueshed/railroad";
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
  const remove = (id: string) => notes.send([{ op: "remove", path: `/notes/${id}` }]).catch(() => toast("Not saved", "alert"));

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
- `registerDoc` applies any well-formed change. To allow only some, refuse the rest before delta applies them, as `src/resources/message/message-api.ts` does: a throw with a `code` is the answer, and nothing changes.
- The page has one socket, in `src/app.tsx`; every document rides it, and it reconnects and reopens them itself.

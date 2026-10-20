# A new document

A shared document, made the way `message` is: three files, then wired into the page. Its schema says what the rows are and its `defineDoc` what someone has in front of them; delta keeps them in a JSON file, and the same two definitions run on SQLite and Postgres. Notes show the other two verbs, `add` and `remove`. Its stories and tests are in [testing.md](testing.md).

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
import { joinPath } from "@blueshed/delta/core";
import { Plus, Trash2 } from "lucide";
import { bento, go, rowsOf, type Address } from "../bento";
import { toast } from "../toast";
import { notes } from "./notes";

const { cell, row, tool, addModal, confirmModal } = bento();
const all = notes.data.map((d) => Object.values(d?.notes ?? {}));

/** The notes on the box: every one, a row each, and the bin that asks to remove it. */
export function NotesCell() {
  return cell({
    name: "Notes",
    count: () => all.get().length,
    body: rowsOf(all, (n) => n.id, (n$) => row({ what: () => n$.get().text, act: tool("Remove", { icon: Trash2, iconOnly: true, kind: "quiet", on: () => go("", "remove-note", n$.peek().id)() }) }), "No notes yet."),
  });
}

/** Beside the page's name: a new note. */
export const AddNote = () => tool("Add a note", { icon: Plus, on: go("", "new-note") });

/** What a note asks over the box: its words, when it is new; whether, when it is to go. Send, and let the change that comes back draw it. */
export function NoteModal(at: Address) {
  const done = go("");
  const refused = () => toast("Not saved", "alert");
  if (at.what === "new-note")
    return addModal("Add a note", [{ name: "text", label: "The note" }], ({ text }) => void notes.send([{ op: "add", path: "/notes/-", value: { text } }]).then(done, refused), done);
  if (at.what === "remove-note") {
    const id = Number(at.which);
    const text = notes.data.peek()?.notes[id]?.text ?? "";
    return confirmModal("Remove the note?", `"${text}" goes from every page.`, () => void notes.send([{ op: "remove", path: joinPath("notes", id) }]).then(done, refused), done);
  }
  return null;
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

The page has it as a cell on the box, a deed beside its name, and what it asks over the box:

```tsx
// src/app.tsx: after import { StatusCell } from "./resources/status/status-view";
import { AddNote, NoteModal, NotesCell } from "./resources/notes/notes-view";
```

```tsx
// src/app.tsx: after MessageCell(),
NotesCell(),
```

```tsx
// src/app.tsx: after const actions = (): Node[] => [
  AddNote(),
```

```tsx
// src/app.tsx: before return null; // nothing asks
if (at.what === "new-note" || at.what === "remove-note") return NoteModal(at);
```

- Never set a document in the page: `send` the change; it comes back to every window holding it, this one included, and draws there. Adding it locally as well draws it twice.
- A new row is `add /<collection>/-`: the server names it, in the path and as the row's `id`. Address a row by its id, never its position.
- The page is the bento's (`src/resources/bento.tsx`): a document is a cell on the box, changed in a drawer, made or removed in a modal, each opened by where you are (`go("", "<what>", id)`), so Back closes it. A list is `rowsOf`, keyed by id. Say "Not saved" when a `send` rejects, and leave the modal open with what was typed.
- The schema says what a write may be: a field it does not declare, a value of the wrong type, a path outside the document, is refused with 400 and the reason, and nothing changes. An empty write writes nothing.
- Build a path from ids with `joinPath`, never a template.
- The page has one socket, in `src/app.tsx`; every document rides it, and it reconnects and reopens them itself.

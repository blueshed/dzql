import { db } from "../db";
import { reading } from "../../../src/reading";
import { parseAddress, patchCollections, type Collections } from "../../../src/bento";
import type { PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";
import { integer } from "./values";
import { kindOf, type Kind } from "./wedding";

// A visit: what one session is doing on the site. `code` is who they are; `ui` is where they are.
// Nothing here goes on the ledger: which page a tab is on, or which drawer it has open, is not the
// wedding's history, and a household pressing Undo means "take back my last answer", never "go
// back a page". The domain writes (documents/household.ts, documents/board.ts) are what the
// ledger records.

export type Ui = {
  /**
   * Where the visit is: one address (src/bento.ts). The trail below the root -- "" is the
   * household's box or the couple's home; "asks", "households/3/asks" -- and after a `?` the one
   * thing open over it: a guest's drawer (`?guest=2`), a gift's (`?gift=1`), a row's keep drawer
   * (`?keep=courses/2`), the answer (`?answer`), the modal asking a new thing's name
   * (`?new=guests`), the modal confirming a removal (`?confirm=courses/2`).
   */
  page?: string;
} & Collections; // how each collection is read, find's word, the eye: by the collection's name

/** What is open over the page, read out of the address: the path, and at most one of the rest. */
export type Over = { path: string; focus?: number; gift?: number; keep?: string; answering?: true; new?: string; confirm?: string };

export function over(ui: Ui): Over {
  const { path, what, which = "" } = parseAddress(ui.page);
  if (what === "guest") return { path, focus: integer(which) };
  if (what === "gift") return { path, gift: integer(which) };
  if (what === "answer") return { path, answering: true };
  if (what === "keep" || what === "new" || what === "confirm") return { path, [what]: which };
  return { path };
}

export type SessionDocument = { code: string | null; kind: Kind | null; ui: Ui; note: string | null };

const readStmt = db.query<{ code: string | null; ui: string; note: string | null }, [string]>(
  "SELECT code, ui, note FROM visits WHERE id = ?",
);
const upsertStmt = db.query<unknown, [string, string | null, string, string | null, number]>(`
  INSERT INTO visits (id, code, ui, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
  ON CONFLICT(id) DO UPDATE SET code = ?2, ui = ?3, note = ?4
`);

export function read(id: string): SessionDocument {
  reading("session", id);
  const row = readStmt.get(id);
  if (!row) return { code: null, kind: null, ui: {}, note: null };
  // A code that has since stopped existing reads as no code at all: the tab is back at the welcome.
  const kind = row.code ? kindOf(row.code) : null;
  return { code: kind ? row.code : null, kind, ui: JSON.parse(row.ui), note: row.note };
}

function save(id: string, doc: SessionDocument): void {
  upsertStmt.run(id, doc.code, JSON.stringify(doc.ui), doc.note, Date.now());
}

/** A modal asks one question; the write that answers it puts it away (rule 14): an add answers the ask, a removal answers the asking-first. The visit is back on the page it was asked from. */
export function closeAnswered(id: string, applied: { op: string; path: string }[]): void {
  const at = over(read(id).ui);
  const answered = (at.new !== undefined && applied.some((op) => op.op === "add" && op.path.endsWith("/-"))) || (at.confirm !== undefined && applied.some((op) => op.op === "remove"));
  if (answered) patch(id, [{ op: "replace", path: "/page", value: at.path }]);
}

export type SessionPatchResult = { version: number; applied: PatchOp[] };

/** Applies a patch. No ledger entry (see the header), so the version is always 0. One
 * transaction all the same: this loop's several statements commit together or not at all. */
export const patch = db.transaction(function patch(id: string, ops: PatchOp[]): SessionPatchResult {
  const applied: PatchOp[] = [];

  for (const op of ops) {
    const [field] = parsePointer(op.path);
    const before = read(id);
    const next: SessionDocument = { ...before, ui: { ...before.ui } };
    const removing = op.op === "remove";

    if (field === "code") {
      if (removing) {
        Object.assign(next, { code: null, kind: null, ui: {}, note: null });
      } else {
        const code = String(op.value ?? "").trim().toUpperCase();
        const kind = code ? kindOf(code) : null;
        if (!kind) {
          // The one refusal the welcome has to say out loud: the write did not apply, and the
          // page would otherwise look exactly as it did before the code was typed.
          save(id, { ...next, note: "That code was not recognised." });
          continue;
        }
        Object.assign(next, { code, kind, ui: {}, note: null });
      }
    } else if (field === "resend") {
      const email = String(op.value ?? "").trim();
      if (!email) continue;
      // No email leaves this example: the resend is a stub that logs, and the welcome says the
      // same thing whether or not the address is known (brief.md: "saying nothing else").
      console.log(`resend requested for ${email}`);
      next.note = "Sent, if we know that address.";
    } else if (field === "page") {
      // The address is the page and whatever is open over it, so going anywhere puts away the
      // drawer or the modal that was open. How each collection is read, and what find says, are
      // the collection's own and stay.
      next.ui.page = removing ? "" : String(op.value ?? "");
    } else if (patchCollections(next.ui, op)) {
      // how a collection is read, find's word, the eye: the bento's own (src/bento.ts)
    } else {
      continue;
    }

    save(id, next);
    applied.push(op);
  }

  return { version: 0, applied };
});

import { db } from "../db";
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
  /** The trail below the root: "" is the household's box or the couple's home; "asks", "households/3/asks", ... */
  page?: string;
  /** The guest whose drawer is open. */
  focus?: number;
  /** The gift whose drawer is open. */
  gift?: number;
  /** The row whose keep drawer is open, as "<table>/<id>". */
  keep?: string;
  /** The answer drawer is open (a household's own; the couple's welcome). */
  answering?: true;
  /** The modal asking a new thing's name is open, named by its collection ("guests", "asks", "courses", ...). */
  new?: string;
  /** The modal confirming a removal is open, as "<table>/<id>". */
  confirm?: string;
  /** How each collection is being read: "photo" or "list", by the collection's name. */
  reading?: Record<string, string>;
};

export type SessionDocument = { code: string | null; kind: Kind | null; ui: Ui; note: string | null };

const readStmt = db.query<{ code: string | null; ui: string; note: string | null }, [string]>(
  "SELECT code, ui, note FROM visits WHERE id = ?",
);
const upsertStmt = db.query<unknown, [string, string | null, string, string | null, number]>(`
  INSERT INTO visits (id, code, ui, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
  ON CONFLICT(id) DO UPDATE SET code = ?2, ui = ?3, note = ?4
`);

export function read(id: string): SessionDocument {
  const row = readStmt.get(id);
  if (!row) return { code: null, kind: null, ui: {}, note: null };
  // A code that has since stopped existing reads as no code at all: the tab is back at the welcome.
  const kind = row.code ? kindOf(row.code) : null;
  return { code: kind ? row.code : null, kind, ui: JSON.parse(row.ui), note: row.note };
}

function save(id: string, doc: SessionDocument): void {
  upsertStmt.run(id, doc.code, JSON.stringify(doc.ui), doc.note, Date.now());
}

export type SessionPatchResult = { version: number; applied: PatchOp[] };

/** Applies a patch. No ledger entry (see the header), so the version is always 0. One
 * transaction all the same: this loop's several statements commit together or not at all. */
export const patch = db.transaction(function patch(id: string, ops: PatchOp[]): SessionPatchResult {
  const applied: PatchOp[] = [];

  for (const op of ops) {
    const [field, key] = parsePointer(op.path);
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
      // A drawer or a modal belongs to the page it was opened on: leaving the page closes it.
      // How each collection is read is kept.
      next.ui = { page: String(op.value ?? ""), reading: before.ui.reading };
    } else if (field === "focus" || field === "gift") {
      const n = integer(op.value);
      if (!removing && n === undefined) continue;
      if (removing) delete next.ui[field];
      else next.ui[field] = n;
    } else if (field === "keep") {
      if (removing) delete next.ui.keep;
      else next.ui.keep = String(op.value ?? "");
    } else if (field === "answering") {
      if (removing) delete next.ui.answering;
      else next.ui.answering = true;
    } else if (field === "new" || field === "confirm") {
      if (removing) delete next.ui[field];
      else next.ui[field] = String(op.value ?? "");
    } else if (field === "reading" && key && !removing) {
      next.ui.reading = { ...next.ui.reading, [key]: String(op.value ?? "") };
    } else {
      continue;
    }

    save(id, next);
    applied.push(op);
  }

  return { version: 0, applied };
});

import { db } from "../delta";
import { read as readDoc } from "../../../src/documents";
import { parseAddress, patchCollections, type Collections } from "../../../src/bento";
import type { PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";
import { integer } from "./values";

// A visit, kept in delta (`session:<id>`, ../delta.ts): what one session is doing on the site.
// `code` is who they are; the page and how its collections are read is where they are; `note` is
// the one line the welcome says back. Nothing here goes on the ledger: which page a tab is on, or
// which drawer it has open, is not the wedding's history, and a household pressing Undo means
// "take back my last answer", never "go back a page".

export type Kind = "household" | "couple";

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

/** A visit: who (a code, whose it is, and the id of their document -- the household's, or the wedding's for the couple), where, and the welcome's note. */
export type SessionDocument = { code: string | null; kind: Kind | null; id: string | null; ui: Ui; note: string | null };

type Visit = { code: string | null; page: string | null; reading: Ui["reading"] | null; filter: Ui["filter"] | null; hide: Ui["hide"] | null; note: string | null };

const householdOf = db.query<{ id: string }, [string]>("SELECT id FROM wedding_households WHERE code = ?");
const coupleOf = db.query<{ id: string }, [string]>("SELECT weddings_id AS id FROM wedding_couples WHERE code = ?");

/**
 * Whose code this is, and the id of the document it opens: a household's own, or the couple's
 * wedding. A code is a credential, looked up, never a document anyone reads. Codes are stored
 * upper-case; compare the same way.
 */
export function whose(code: string): { kind: Kind; id: string } | null {
  const upper = code.toUpperCase();
  const household = householdOf.get(upper);
  if (household) return { kind: "household", id: household.id };
  const couple = coupleOf.get(upper);
  return couple ? { kind: "couple", id: couple.id } : null;
}

function visitOf(id: string): Visit {
  const row = readDoc<{ visits?: Partial<Visit> }>(`session:${id}`)?.visits ?? {};
  return { code: row.code ?? null, page: row.page ?? null, reading: row.reading ?? null, filter: row.filter ?? null, hide: row.hide ?? null, note: row.note ?? null };
}

export function read(id: string): SessionDocument {
  const v = visitOf(id);
  const ui: Ui = {};
  if (v.page !== null) ui.page = v.page;
  if (v.reading) ui.reading = v.reading;
  if (v.filter) ui.filter = v.filter;
  if (v.hide) ui.hide = v.hide;
  // A code that has since stopped existing reads as no code at all: the tab is back at the welcome.
  const who = v.code ? whose(v.code) : null;
  return { code: who ? v.code : null, kind: who?.kind ?? null, id: who?.id ?? null, ui, note: v.note };
}

/** The visit after `ops`, as the wire said them: a code entered (or not recognised), a resend, a page, a reading. */
function after(before: Visit, ops: PatchOp[]): Visit {
  const next: Visit = { ...before };
  for (const op of ops) {
    const [field] = parsePointer(op.path);
    const removing = op.op === "remove";
    if (field === "code") {
      const code = removing ? "" : String(op.value ?? "").trim().toUpperCase();
      if (removing) Object.assign(next, { code: null, page: null, reading: null, filter: null, hide: null, note: null });
      // The one refusal the welcome says out loud: the page would otherwise look exactly as before.
      else if (!code || !whose(code)) next.note = "That code was not recognised.";
      else Object.assign(next, { code, page: null, reading: null, filter: null, hide: null, note: null });
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
      next.page = removing ? "" : String(op.value ?? "");
    } else {
      const ui: Collections = { reading: next.reading ?? undefined, filter: next.filter ?? undefined, hide: next.hide ?? undefined };
      if (!patchCollections(ui, op)) continue; // how a collection is read, find's word, the eye: the bento's own
      Object.assign(next, { reading: ui.reading ?? null, filter: ui.filter ?? null, hide: ui.hide ?? null });
    }
  }
  return next;
}

/** What a write to a visit becomes: each field it moves, replaced whole (at `/visits`). */
export function shape(id: string, ops: PatchOp[]): PatchOp[] {
  const before = visitOf(id);
  const next = after(before, ops);
  return (Object.keys(next) as (keyof Visit)[])
    .filter((field) => JSON.stringify(next[field]) !== JSON.stringify(before[field]))
    .map((field) => ({ op: "replace", path: `/${field}`, value: next[field] }));
}

/** A modal asks one question; the write that answers it puts it away (rule 14): an add answers the ask, a removal answers the asking-first. The ops that do it, for the visit, or none. */
export function answered(session: SessionDocument, ops: { op: string; path: string }[]): PatchOp[] {
  const at = over(session.ui);
  const yes = (at.new !== undefined && ops.some((op) => op.op === "add" && op.path.endsWith("/-"))) || (at.confirm !== undefined && ops.some((op) => op.op === "remove"));
  return yes ? [{ op: "replace", path: "/visits/page", value: at.path }] : [];
}

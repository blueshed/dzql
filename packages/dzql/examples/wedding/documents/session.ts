import { db } from "../delta";
import { read as readDoc } from "dzql/rendering/documents";
import { address, collectionsWrite, parseAddress, type Collections } from "dzql/rendering/bento";
import type { PatchOp } from "dzql/rendering/json-patch";
import { splitPath } from "@blueshed/delta/core";
import { integer } from "./values";
import { refuse } from "dzql/rendering/refusal";

// A visit, kept in delta (`session:<id>`, ../delta.ts): what one session is doing on the site.
// `code` is who they are; how its collections are read is theirs; `note` is what the welcome says
// back to a resend. Where they are -- the page, and the drawer open over it -- is each tab's own
// (dzql/rendering/tabs), given beside the visit to draw and to shape a write by. Nothing here goes on
// the ledger: which page a tab is on, or which drawer it has open, is not the wedding's history, and
// a household pressing Undo means "take back my last answer", never "go back a page".

export type Kind = "household" | "couple";

export type Ui = {
  /**
   * Where the tab is: one address (src/rendering/bento.ts), the tab's own. The page -- "" is the household's photo or
   * the couple's, of every family; "list", "everyone" -- and after a `?` the one thing open over
   * it: a guest's drawer (`?guest=2`), a family's (`?family=2`), one opened by its name alone
   * (`?gifts`, `?day`, `?stay` for a household; `?courses`, `?gifts`, `?events`, `?places` for
   * the couple), a row's keep drawer (`?keep=courses/2`), the answer (`?answer`), the modal asking
   * a new thing's name (`?new=guests`), the modal confirming a removal (`?confirm=courses/2`). A
   * page drawn from its shape ("venues", src/rendering/derive.ts) reads its own: `?row=1`, `?new`, `?confirm=1`.
   */
  page?: string;
} & Collections; // how each collection is read, find's word, the eye: by the collection's name

/** A drawer opened by its name alone: what the couple tell every household, and the lists the couple keep. */
export type Named = "gifts" | "day" | "stay" | "courses" | "events" | "places";
const NAMED = new Set<string>(["gifts", "day", "stay", "courses", "events", "places"]);

/** What is open over the page, read out of the address: the path, and at most one of the rest. */
export type Over = { path: string; focus?: number; family?: number; drawer?: Named; keep?: string; answering?: true; new?: string; confirm?: string };

export function over(ui: Ui): Over {
  const { path, what, which = "" } = parseAddress(ui.page);
  if (what === "guest") return { path, focus: integer(which) };
  if (what === "family") return { path, family: integer(which) };
  if (what && NAMED.has(what)) return { path, drawer: what as Named };
  if (what === "answer") return { path, answering: true };
  if (what === "keep" || what === "new" || what === "confirm") return { path, [what]: which };
  return { path };
}

/** A visit: who (a code, whose it is, and the id of their document -- the household's, or the wedding's for the couple), where, and the welcome's note. */
export type SessionDocument = { code: string | null; kind: Kind | null; id: string | null; ui: Ui; note: string | null };

type Visit = { code: string | null; page: string | null; reading: Ui["reading"] | null; filter: Ui["filter"] | null; hide: Ui["hide"] | null; note: string | null };

const householdOf = db.query<{ id: string }, [string]>("SELECT id FROM current_wedding_households WHERE code = ?");
const coupleOf = db.query<{ id: string }, [string]>("SELECT weddings_id AS id FROM current_wedding_couples WHERE code = ?");

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

/** The visit as kept, and where the tab stands (`page`), which no visit keeps. */
function visitOf(id: string, page: string | null = null): Visit {
  const row = readDoc<{ visits?: Partial<Visit> }>(`session:${id}`)?.visits ?? {};
  return { code: row.code ?? null, page, reading: row.reading ?? null, filter: row.filter ?? null, hide: row.hide ?? null, note: row.note ?? null };
}

/** A visit, and, given one, where its tab stands (`page`): what a page is drawn from. */
export function read(id: string, page?: string): SessionDocument {
  const v = visitOf(id, page);
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
    const [field] = splitPath(op.path);
    const removing = op.op === "remove";
    if (field === "code") {
      const code = removing ? "" : String(op.value ?? "").trim().toUpperCase();
      if (removing) Object.assign(next, { code: null, page: null, reading: null, filter: null, hide: null, note: null });
      // Said beside the code box (src/rendering/refusal.ts): the page would otherwise look exactly as before.
      else if (!code || !whose(code)) throw refuse("That code was not recognised.");
      else Object.assign(next, { code, page: null, reading: null, filter: null, hide: null, note: null });
    } else if (field === "resend") {
      const email = String(op.value ?? "").trim();
      if (!email) continue;
      // No email leaves this example: the resend is a stub that logs, and the welcome says the
      // same thing whether or not the address is known (the wedding's brief: "saying nothing else").
      console.log(`resend requested for ${email}`);
      next.note = "Sent, if we know that address.";
    } else if (field === "page") {
      // The address is the page and whatever is open over it, so going anywhere puts away the
      // drawer or the modal that was open. How each collection is read, and what find says, are
      // the collection's own and stay. It is the tab's: the kernel moves the tab that sent it.
      next.page = removing ? "" : String(op.value ?? "");
    } else {
      const ui: Collections = { reading: next.reading ?? undefined, filter: next.filter ?? undefined, hide: next.hide ?? undefined };
      if (!collectionsWrite(op, ui)?.length) continue; // how a collection is read, find's word, the eye: the bento's own
      Object.assign(next, { reading: ui.reading ?? null, filter: ui.filter ?? null, hide: ui.hide ?? null });
    }
  }
  return next;
}

/** What a write to a visit becomes, from the tab that sent it, where it stands (`page`): each field it moves, replaced whole (at `/visits`). */
export function shape(id: string, page: string, ops: PatchOp[]): PatchOp[] {
  const before = visitOf(id, page);
  const next = after(before, ops);
  return (Object.keys(next) as (keyof Visit)[])
    .filter((field) => JSON.stringify(next[field]) !== JSON.stringify(before[field]))
    .map((field) => ({ op: "replace", path: `/${field}`, value: next[field] }));
}

/** A modal asks one question; the write that answers it puts it away: an add answers the
 * ask, a removal answers the asking-first. A removal goes back to the drawer it was asked from --
 * the family a guest was taken off, the list a row left -- and an add to the page. Where the tab
 * that wrote goes, from where it stands (`page`), or nowhere. */
export function answered(page: string, ops: { op: string; path: string }[]): string | undefined {
  const at = over({ page });
  if (at.new !== undefined && ops.some((op) => op.op === "add" && op.path.endsWith("/-"))) return at.path;
  if (at.confirm === undefined || !ops.some((op) => op.op === "remove")) return undefined;
  // a row of a page drawn from its shape (src/rendering/derive.ts) is confirmed by its id alone, and goes back to that page
  const [list, family] = at.confirm.split("/");
  return family === undefined ? at.path : list === "households" ? address(at.path, "family", family) : address(at.path, list);
}

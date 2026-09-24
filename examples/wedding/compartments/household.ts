import * as householdDoc from "../documents/household";
import * as sessionDoc from "../documents/session";
import * as weddingDoc from "../documents/wedding";
import type { PatchOp } from "../../../src/json-patch";
import type { Compartment, WriteResult } from "../../../src/compartments/compartment";
import { allOpenSockets, notify } from "../../../src/compartments/audience";
import type { HtmlOp } from "../../../src/compartments/render";
import * as boardDoc from "../documents/board";
import { boardMini, boardPhoto, familyGuestRow, familyPhoto, reading as boardReading } from "../views/board";
import { dressMount, everyonePhoto, familyMini, familyPhoto as ownPhoto, guestRow, householdPages, menuMount, reading, type HouseholdView } from "../views/household";
import { welcome } from "../views/welcome";

// A household's document, written by the household that arrived by its code. Nearly everything
// it writes changes what everyone sees -- an answer puts figures in the photo every code watches,
// a claim takes a gift from every other household, the couple's board counts it all -- so a write
// here echoes to those who see the document (its own tabs, and the couple's, whose board reads it) and asks
// everyone to re-render (still everyone, on purpose: an aggregate view -- the couple's totals,
// the "everyone" photo -- can change from any household's write, and there is no smaller
// audience for that yet; item 1's kernel registry is what this now reaches through, not a
// registry of the wedding's own).

type Rule = { path: RegExp; ops: PatchOp["op"][]; /** Locked after the deadline. */ dated?: boolean };

/** The household's writable surface: which paths, with which ops. Whether the value is valid is documents/household.ts's call. */
const RULES: Rule[] = [
  { path: /^\/answer$/, ops: ["replace", "remove"], dated: true },
  { path: /^\/message$/, ops: ["replace", "remove"] },
  { path: /^\/guests\/-$/, ops: ["add"] },
  { path: /^\/guests\/\d+\/coming$/, ops: ["replace", "remove"], dated: true },
  { path: /^\/guests\/\d+\/minifigure\/(skin|hair|hair_color|top|legs|face|attitude)$/, ops: ["replace"] },
  { path: /^\/guests\/\d+\/choices\/\d+\/(dish|drink)$/, ops: ["replace", "remove"], dated: true },
  { path: /^\/asks\/-$/, ops: ["add"] },
  { path: /^\/claims\/-$/, ops: ["add"] },
  { path: /^\/claims\/\d+$/, ops: ["remove"] },
];

/** Echoes a household document's ops to everyone who sees it (its own tabs, and the couple's,
 * whose board reads it), then asks everyone to bring their page up to date -- naming the write, so
 * `fragments` below can say what that means per page. Shared by a direct write and by undo
 * landing on this doc. */

/** Everything a household's pages read, for this session. */
function viewFor(session: sessionDoc.SessionDocument): HouseholdView | undefined {
  const h = householdDoc.read(session.code!);
  if (!h) return undefined;
  return {
    session,
    h,
    w: weddingDoc.wedding(),
    courses: weddingDoc.courses(),
    gifts: weddingDoc.gifts(),
    events: weddingDoc.events(),
    places: weddingDoc.places(),
    photo: weddingDoc.photo(),
    open: weddingDoc.answersOpen(),
    names: weddingDoc.namesRevealed(),
  };
}

const replace = (target: string, html: string): HtmlOp => ({ op: "replace", target, html });


/** A household's pages. `viewFor` is always there in practice: read() only reports a kind for a code that exists. */
export function renderHousehold(session: sessionDoc.SessionDocument): string | undefined {
  const v = viewFor(session);
  return v && householdPages(v);
}

export const household: Compartment = {
  docType: "household",
  resolveDoc(ws) {
    const session = sessionDoc.read(ws.data.sessionId);
    return session.kind === "household" ? session.code! : undefined;
  },
  // Beyond its own tabs (`resolveDoc`), the couple see every household: the board reads each one
  // it draws, so their page's reads say so (src/reading.ts).
  permit(ws, op) {
    const session = sessionDoc.read(ws.data.sessionId);
    if (session.kind !== "household") return false;
    const rule = RULES.find((r) => r.path.test(op.path) && r.ops.includes(op.op));
    if (!rule) return false;
    if (rule.dated && !weddingDoc.answersOpen()) return false;
    if (op.path === "/guests/-") {
      // A plus-one only while the invitation gave them one they have not yet named.
      const h = householdDoc.read(session.code!)!;
      return h.guests.filter((g) => g.named_by === "household").length < h.plus_ones;
    }
    return true;
  },
  write(ws, code, ops, undoes): WriteResult {
    // The wire may name a plus-one or an ask and nothing more. The whole-row shape the document
    // also accepts -- an id, who named them, coming, a look; a reply -- is what an inverse carries,
    // and only an undo or a redo may bring it: a household that sent `named_by: "couple"` would
    // otherwise never be counted against its invitation. permit() saw each op on its own, before
    // any was applied, so the plus-ones still owed are counted down here across the message.
    const fresh = undoes === undefined;
    const h = householdDoc.read(code)!;
    let owed = h.plus_ones - h.guests.filter((g) => g.named_by === "household").length;
    const named = !fresh ? ops : ops.flatMap((op) => {
      if (op.op !== "add" || (op.path !== "/guests/-" && op.path !== "/asks/-")) return [op];
      if (op.path === "/guests/-" && owed-- <= 0) return [];
      const name = typeof op.value === "string" ? op.value : (op.value as { name?: unknown } | null)?.name;
      return [{ ...op, value: { name } }];
    });
    const result = householdDoc.patch(code, named, ws.data.sessionId, undoes);
    if (fresh) sessionDoc.closeAnswered(ws.data.sessionId, result.applied);
    notify("household", code, result, { renderTo: allOpenSockets() });
    return result;
  },
  // The delta in HTML's terms, for the two writes that happen most -- a look changing, a
  // choice made -- which touch only the applets and rows that show that guest. Per viewer:
  // the household itself sees its family photo, the open drawer, or a row of the list; the
  // couple see the board's photo or a family's box; every other household sees nothing, unless
  // it is looking at the photo of everyone. Any other write declines, and the page goes out.
  fragments(ws, code, result): HtmlOp[] | undefined {
    const guests = new Set<number>();
    let looks = false;
    let choices = false;
    for (const op of result.applied) {
      const m = /^\/guests\/(\d+)\/(minifigure|choices)\//.exec(op.path);
      if (!m) return undefined;
      guests.add(Number(m[1]));
      if (m[2] === "minifigure") looks = true;
      else choices = true;
    }
    const session = sessionDoc.read(ws.data.sessionId);
    const at = sessionDoc.over(session.ui);
    const [head, second, third] = at.path.split("/");
    const ops: HtmlOp[] = [];

    if (session.kind === "household") {
      const v = viewFor(session)!;
      const own = session.code === code;
      if (head === "everyone") {
        if (looks) ops.push(replace("#everyone-photo", everyonePhoto(v, second ?? null)));
      } else if (own && head === "guests") {
        // the guests grown into the window: the photo, or the rows of the list
        if (reading(v, "guests") === "photo") {
          if (looks) ops.push(replace("#family-photo", ownPhoto(v)));
        } else if (choices) {
          for (const g of v.h.guests) if (guests.has(g.id)) ops.push(replace(`#guest-${g.id}`, guestRow(v, g, session.ui.filter?.guests, session.ui.hide?.guests)));
        }
      } else if (own && !head) {
        // the box: the guests' small reading, still
        if (looks) ops.push(replace("#family-mini", familyMini(v)));
      }
      if (own) {
        const focused = v.h.guests.find((g) => g.id === at.focus);
        if (focused && guests.has(focused.id)) {
          if (looks) ops.push(replace(`#dress-${focused.id}`, dressMount(v, focused)));
          if (choices) ops.push(replace(`#menu-${focused.id}`, menuMount(v, focused)));
        }
      }
      return ops;
    }

    if (session.kind === "couple") {
      const b = boardDoc.read(session.code!)!;
      const h = b.households.find((x) => x.code === code);
      if (!h) return undefined;
      const v = { session, b };
      if (!head) {
        if (looks) ops.push(replace("#board-mini", boardMini(b)));
      } else if (head === "households" && second === undefined) {
        if (looks && boardReading(v, "households") === "photo") ops.push(replace("#board-photo", boardPhoto(v)));
      } else if (head === "households" && second === String(h.id)) {
        if (third === "guests") {
          if (boardReading(v, `family-${h.id}`) === "photo") {
            if (looks) ops.push(replace("#family-photo", familyPhoto(h)));
          } else if (choices) {
            for (const g of h.guests) if (guests.has(g.id)) ops.push(replace(`#guest-${g.id}`, familyGuestRow(v, g)));
          }
        } else if (third === undefined) {
          if (looks) ops.push(replace("#family-mini", familyPhoto(h, "family-mini")));
        }
      }
      return ops;
    }

    return undefined;
  },
};

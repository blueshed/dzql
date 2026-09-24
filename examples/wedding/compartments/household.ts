import * as householdDoc from "../documents/household";
import * as sessionDoc from "../documents/session";
import * as weddingDoc from "../documents/wedding";
import type { PatchOp } from "../../../src/json-patch";
import type { Compartment, WriteResult } from "../../../src/compartments/compartment";
import { allOpenSockets, notify } from "../../../src/compartments/audience";
import * as boardDoc from "../documents/board";
import { householdPages, type HouseholdView } from "../views/household";
import { welcome } from "../views/welcome";

// A household's document, written by the household that arrived by its code. Nearly everything
// it writes changes what everyone sees -- an answer puts figures in the photo every code watches,
// a claim takes a gift from every other household, the couple's board counts it all -- so a write
// here echoes to those who see the document (its own tabs, and the couple's, whose board reads it) and
// redraws every open page (on purpose: an aggregate -- the couple's totals, the "everyone" photo --
// can change from any household's write). Each page is sent only the parts of it that changed.

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
};

import * as householdDoc from "../documents/household";
import * as sessionDoc from "../documents/session";
import * as weddingDoc from "../documents/wedding";
import type { PatchOp } from "../../../src/json-patch";
import type { Compartment } from "../../../src/compartments/compartment";
import { serverWrite } from "../../../src/documents";
import { householdPages, type HouseholdView } from "../views/household";
import { keepEveryone } from "../everyone";
import { refuse } from "../../../src/refusal";

// A household's document (`household:<id>`), written by the household that arrived by its code.
// Nearly everything it writes changes what others see -- an answer puts figures in the photo every
// household watches, a claim takes a gift from every other household, the couple's board counts
// it all -- and each follows from what their pages read: the board holds this household's rows
// (delta's fan-out), and the photo and the gifts' counts are kept in `everyone` (../everyone.ts).
// Each page is sent only the parts of it that changed.

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

/** The fields the dated rules write, as the document holds them: `/households` answer, a guest's coming and choices. */
const DATED = new Set(["answer", "coming", "choices"]);

/** Everything a household's pages read, for this session. */
function viewFor(session: sessionDoc.SessionDocument): HouseholdView | undefined {
  const h = householdDoc.read(session.id!);
  if (!h) return undefined;
  const w = weddingDoc.wedding();
  return {
    session,
    h,
    w,
    courses: weddingDoc.courses(),
    gifts: weddingDoc.gifts(),
    events: weddingDoc.events(),
    places: weddingDoc.places(),
    photo: weddingDoc.photo(),
    open: weddingDoc.answersOpen(),
    names: weddingDoc.namesRevealed(w.day),
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
    return session.kind === "household" ? session.id! : undefined;
  },
  // Beyond its own tabs (`resolveDoc`), nobody reads a household's document: the couple read
  // every household in the board, and other households only what `everyone` says.
  permit(ws, op) {
    const session = sessionDoc.read(ws.data.sessionId);
    if (session.kind !== "household") return false;
    const rule = RULES.find((r) => r.path.test(op.path) && r.ops.includes(op.op));
    if (!rule) return false;
    if (rule.dated && !weddingDoc.answersOpen()) return false;
    if (op.path === "/guests/-") {
      // A plus-one only while the invitation gave them one they have not yet named.
      const h = householdDoc.read(session.id!)!;
      return h.guests.filter((g) => g.named_by === "household").length < h.plus_ones;
    }
    return true;
  },
  // After the deadline an answer is locked, to Undo too: a walk that would set back an answer, a
  // guest's coming or their choices is refused, and says why. A walk sets back only the fields its
  // entry changed, so what else a household did -- a look, a claim -- still walks.
  walkable(_ws, _id, ops) {
    if (weddingDoc.answersOpen()) return true;
    if (ops.some((op) => op.op === "replace" && Object.keys((op.value ?? {}) as object).some((f) => DATED.has(f)))) throw refuse("Answers closed at the deadline.");
    return true;
  },
  shape(_ws, id, ops) {
    const offer = { courses: weddingDoc.courses(), gifts: weddingDoc.gifts().map(({ id, shared }) => ({ id, shared })) };
    return householdDoc.shape(householdDoc.read(id)!, offer, ops);
  },
  // the modal that asked is put away by the write that answers it
  async wrote(ws, _id, ops: PatchOp[]) {
    const put = sessionDoc.answered(sessionDoc.read(ws.data.sessionId), ops);
    if (put.length > 0) await serverWrite(`session:${ws.data.sessionId}`, put);
  },
  // an answer, a look, a coming, a claim: what everyone sees of this household follows
  changed: () => keepEveryone(),
};

import type { PatchOp } from "dzql/rendering/json-patch";
import type { Resource } from "dzql/rendering/resources/resource";
import { activeDocuments, settled } from "dzql/rendering/documents";
import { refuse, tell } from "dzql/rendering/refusal";
import * as householdDoc from "./household-api";
import * as sessionDoc from "../session/session-api";
import * as weddingDoc from "../wedding/wedding-api";
import { putAway } from "../session/session";
import { keepEveryone } from "../../everyone";

// A household's document (`household:<id>`), written by the household that arrived by its code.
// Nearly everything it writes changes what others see -- an answer puts figures in the photo every
// household watches, a claim takes a gift from every other household, the couple's board counts
// it all -- and each follows from what their pages read: the board holds this household's rows
// (delta's fan-out), and the photo and the gifts' counts are kept in `everyone` (../../everyone.ts).
// Each page is sent only the parts of it that changed.

type Rule = { path: RegExp; ops: PatchOp["op"][]; /** Locked after the deadline. */ dated?: boolean };

/** The household's writable surface: which paths, with which ops. Whether the value is valid is ./household-api.ts's call. */
const RULES: Rule[] = [
  { path: /^\/answer$/, ops: ["replace", "remove"], dated: true },
  { path: /^\/message$/, ops: ["replace"] }, // emptied by replacing it with nothing
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

export const household: Resource = {
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
    if (op.path === "/guests/-" || op.path === "/asks/-") {
      // A plus-one only while the invitation gave them one they have not yet named; an ask only once they have.
      const h = householdDoc.read(session.id!)!;
      const owed = h.guests.filter((g) => g.named_by === "household").length < h.plus_ones;
      return op.path === "/guests/-" ? owed : !owed;
    }
    return true;
  },
  // After the deadline an answer is locked, to Undo too: a walk that would set back an answer, a
  // guest's coming or their choices is refused, and says why. A walk sets back only the fields its
  // entry changed, so what else a household did -- a look, a claim -- still walks.
  permitUndo(_ws, _id, ops) {
    if (weddingDoc.answersOpen()) return true;
    if (ops.some((op) => op.op === "replace" && DATED.has(op.path.split("/").at(-1)!))) throw refuse("Answers closed at the deadline."); // each field it sets back, by its path
    return true;
  },
  shape(_ws, id, ops) {
    const offer = { courses: weddingDoc.courses(), gifts: weddingDoc.gifts().map(({ id, shared }) => ({ id, shared })) };
    return householdDoc.shape(householdDoc.read(id)!, offer, ops);
  },
  afterWrite: putAway,
  // What an Undo or a Redo did, said over the page, where Undo is: what it changed may be in a
  // drawer that is shut, or in a photo someone else is watching.
  async afterWalk(ws, id, { way, ops, inverse }) {
    const [left, was] = way === "undo" ? [inverse, ops] : [ops, inverse];
    const words = await settled(activeDocuments(), () => householdDoc.whatItDid(left, was, householdDoc.read(id)!, weddingDoc.gifts()));
    if (words.length > 0) await tell(ws.data.sessionId, { doc: "ledger", path: "/latest", said: `${way === "undo" ? "Undone" : "Redone"}: ${words.join(", ")}.` });
  },
  // an answer, a look, a coming, a claim: what everyone sees of this household follows
  afterChange: () => keepEveryone(),
};

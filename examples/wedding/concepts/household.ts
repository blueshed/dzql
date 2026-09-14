import * as householdDoc from "../documents/household";
import * as sessionDoc from "../documents/session";
import * as weddingDoc from "../documents/wedding";
import { patchMessage, type PatchOp } from "../../../src/json-patch";
import type { Concept, WriteResult } from "../../../src/concepts/concept";
import { renderRequested } from "../../../src/concepts/render";
import { householdPages } from "../views/household";
import * as presence from "./presence";

// A household's document, written by the household that arrived by its code. Nearly everything
// it writes changes what everyone sees -- an answer puts figures in the photo every code watches,
// a claim takes a gift from every other household, the couple's board counts it all -- so a write
// here echoes to those who see the document and asks everyone to re-render.

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

/** Echoes a household document's ops to everyone who sees it, then asks everyone to re-render. Shared by a direct write and by undo landing on this doc. */
function echoAndNotify(code: string, version: number, applied: PatchOp[]): void {
  if (applied.length === 0) return;
  const payload = patchMessage("household", version, applied);
  for (const ws of presence.seeingHousehold(code)) ws.send(payload);
  renderRequested.emit(presence.everyone());
}

export const household: Concept = {
  docType: "household",
  render(sessionId) {
    const session = sessionDoc.read(sessionId);
    if (session.kind !== "household") return undefined;
    const h = householdDoc.read(session.code!);
    if (!h) return undefined; // unreachable in practice: read() only reports a kind for a code that exists
    return householdPages({
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
    });
  },
  resolveDoc(ws) {
    const session = sessionDoc.read(ws.data.sessionId);
    return session.kind === "household" ? session.code! : undefined;
  },
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
  write(ws, code, ops): WriteResult {
    const result = householdDoc.patch(code, ops, ws.data.sessionId);
    echoAndNotify(code, result.version, result.applied);
    return { ...result, rendered: result.applied.length > 0 };
  },
  // Undo landing back on this household: apply the ledger's inverse ops directly -- skipping
  // permit(), since this isn't a fresh request against the writable surface -- then echo and
  // notify exactly as a direct write would.
  replay(ws, code, ops, undoes): WriteResult {
    const result = householdDoc.patch(code, ops, ws.data.sessionId, undoes);
    echoAndNotify(code, result.version, result.applied);
    return { ...result, rendered: result.applied.length > 0 };
  },
};

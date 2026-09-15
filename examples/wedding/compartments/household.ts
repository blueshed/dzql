import * as householdDoc from "../documents/household";
import * as sessionDoc from "../documents/session";
import * as weddingDoc from "../documents/wedding";
import { patchMessage, type PatchOp } from "../../../src/json-patch";
import type { Compartment, WriteResult } from "../../../src/compartments/compartment";
import { renderRequested, type HtmlOp } from "../../../src/compartments/render";
import * as boardDoc from "../documents/board";
import { boardPhoto, familyGuestRow, familyPhoto, reading as boardReading } from "../views/board";
import { dressMount, everyonePhoto, familyPhoto as ownPhoto, guestRow, householdPages, menuMount, reading, type HouseholdView } from "../views/household";
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

/** Echoes a household document's ops to everyone who sees it, then asks everyone to bring their page up to date -- naming the write, so `fragments` below can say what that means per page. Shared by a direct write and by undo landing on this doc. */
function echoAndNotify(code: string, result: WriteResult): void {
  if (result.applied.length === 0) return;
  const payload = patchMessage("household", result.version, result.applied);
  for (const ws of presence.seeingHousehold(code)) ws.send(payload);
  renderRequested.emit({ sockets: presence.everyone(), write: { docType: "household", docId: code, result } });
}

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

export const household: Compartment = {
  docType: "household",
  render(sessionId) {
    const session = sessionDoc.read(sessionId);
    if (session.kind !== "household") return undefined;
    const v = viewFor(session);
    return v && householdPages(v); // v is always there in practice: read() only reports a kind for a code that exists
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
    echoAndNotify(code, result);
    return { ...result, rendered: result.applied.length > 0 };
  },
  // Undo landing back on this household: apply the ledger's inverse ops directly -- skipping
  // permit(), since this isn't a fresh request against the writable surface -- then echo and
  // notify exactly as a direct write would.
  replay(ws, code, ops, undoes): WriteResult {
    const result = householdDoc.patch(code, ops, ws.data.sessionId, undoes);
    echoAndNotify(code, result);
    return { ...result, rendered: result.applied.length > 0 };
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
    const [head, second, third] = (session.ui.page ?? "").split("/");
    const ops: HtmlOp[] = [];

    if (session.kind === "household") {
      const v = viewFor(session)!;
      const own = session.code === code;
      if (head === "everyone") {
        if (looks) ops.push(replace("#everyone-photo", everyonePhoto(v, second ?? null)));
      } else if (own && !head) {
        if (reading(v, "guests") === "photo") {
          if (looks) ops.push(replace("#family-photo", ownPhoto(v)));
        } else if (choices) {
          for (const g of v.h.guests) if (guests.has(g.id)) ops.push(replace(`#guest-${g.id}`, guestRow(v, g)));
        }
        const focused = v.h.guests.find((g) => g.id === session.ui.focus);
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
      if (head === "households" && second === undefined) {
        if (looks && boardReading(v, "households") === "photo") ops.push(replace("#board-photo", boardPhoto(v)));
      } else if (head === "households" && second === String(h.id) && third === undefined) {
        if (boardReading(v, `family-${h.id}`) === "photo") {
          if (looks) ops.push(replace("#family-photo", familyPhoto(h)));
        } else if (choices) {
          for (const g of h.guests) if (guests.has(g.id)) ops.push(replace(`#guest-${g.id}`, familyGuestRow(v, g)));
        }
      }
      return ops;
    }

    return undefined;
  },
};

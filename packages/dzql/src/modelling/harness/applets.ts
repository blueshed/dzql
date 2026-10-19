import type { Heard } from "../../rendering/resources/render";
import { applyPatch, type PatchOp } from "../../rendering/json-patch";
import { decoded, ownProps, splitTag } from "../../rendering/parts";
import { size } from "../costs";

// The applets on a page, for the stories (src/modelling/harness.ts): what each holds as a member's
// page keeps it, its props from a render and the patches taken since (`holding`), which Canon 2
// holds to a fresh render; and what its props cost on the wire, said and not failed (`propsCost`).

/** An applet that takes a document's patches, as a member's page holds it: the props a render gave it, the document's version they hold when the mount says it (`data-v`), and the ops taken since. */
export type Taken = { applet: string; doc: string; under: string; props: string; v?: number; ops: PatchOp[] };

/** Where a page keeps a mount: by its id, or its part, or else its applet and how many were found before it. */
const mountKey = (el: HTMLRewriterTypes.Element, applet: string, before: number): string => el.getAttribute("id") ?? el.getAttribute("data-eta-part") ?? `${applet}#${before}`;

/** The applets on a page that take a document's patches, by their id (or part, or place). */
export function takersOn(page: string): Map<string, Omit<Taken, "ops">> {
  const found = new Map<string, Omit<Taken, "ops">>();
  new HTMLRewriter()
    .on("[data-doc]", {
      element(el) {
        const applet = el.getAttribute("data-applet") ?? "";
        const v = el.getAttribute("data-v");
        found.set(mountKey(el, applet, found.size), { applet, doc: el.getAttribute("data-doc")!, under: el.getAttribute("data-under") ?? "", props: decoded(el.getAttribute("data-props") ?? "null"), ...(v !== null && { v: Number(v) }) });
      },
    })
    .transform(page);
  return found;
}

// What props cost, said and not failed: props that carry an applet's data go again
// whole with every change to it (`propsCost`).

/** How big a mount's own props, as JSON, may be before the harness says so: the document it watches left out. */
export const MOST_PROPS = 4096;

/** A cost a render put on the wire in props: which kind, the applet, and what to say. */
export type PropsCost = { kind: "big" | "again"; applet: string; says: string };

type Mount = { key: string; applet: string; own: string; watching: boolean };

/** The applet mounts in some HTML, keyed as `takersOn` keys them, each with its own props: the document it watches left out. */
function mountsIn(html: string): Mount[] {
  const found: Mount[] = [];
  new HTMLRewriter()
    .on("[data-applet][data-props]", {
      element(el) {
        const applet = el.getAttribute("data-applet")!;
        const key = mountKey(el, applet, found.length);
        const props = decoded(el.getAttribute("data-props")!);
        const watching = el.hasAttribute("data-doc");
        found.push({ key, applet, watching, own: watching ? ownProps(props, decoded(el.getAttribute("data-under") ?? "")) : props });
      },
    })
    .transform(html);
  return found;
}

/** What a render sends `whose` page, drawn as `page`, costs in props: a mount whose own props pass MOST_PROPS; in parts, one sent with the props the page had for it. */
export function propsCost(whose: string, page: string, message: Heard): PropsCost[] {
  if (message.type !== "render") return [];
  const sent = message.html !== undefined ? [{ html: message.html, op: undefined }] : (message.ops ?? []).flatMap((op) => (op.html === undefined ? [] : [{ html: op.html, op }]));
  const had = new Map(mountsIn(page).map((m) => [m.key, m.own]));
  const costs: PropsCost[] = [];
  for (const { html, op } of sent) {
    for (const m of mountsIn(html)) {
      const bytes = Buffer.byteLength(m.own);
      if (bytes > MOST_PROPS) {
        const how = m.watching ? "keep them to what it shows, and for whom" : "let it watch the document they come from (appletProps(props, { doc })), and keep them to what it shows, and for whom";
        costs.push({ kind: "big", applet: m.applet, says: `${whose} was sent the ${m.applet} applet's props, ${size(bytes)}${m.watching ? " beside the document it watches" : ""}, which go again whenever they change: ${how}` });
      }
      if (op && had.get(m.key) === m.own) {
        const itself = mountsIn(splitTag(html)[0])[0]?.key === m.key; // the part is the mount
        const how =
          op.op === "tag" ? "with its tag, for something else on it: keep that beside its mount"
          : itself ? "drawn again for what the server paints inside it, which the applet paints over: let it watch the document it paints from"
          : `in a part drawn again around it (${op.target}) for something else in it: make what changed there a part of its own`;
        costs.push({ kind: "again", applet: m.applet, says: `${whose} was sent the ${m.applet} applet's props again, as they were, ${how}` });
      }
    }
  }
  return costs;
}

/**
 * A member's applets after a render, as the client keeps them: one the render carries (the page
 * whole, or in a part it sends) with props other than those it holds, patched since, starts again
 * from them; one it carries with what it holds, or does not carry, keeps the ops it has taken --
 * its attribute is still the render's that gave it them. Without `message`, the page came whole.
 */
export function retake(taken: Map<string, Taken>, page: string, message?: Heard): void {
  const now = takersOn(page);
  const carried = message?.html !== undefined || !message ? undefined : new Set((message.ops ?? []).flatMap((op) => (op.html === undefined ? [] : [...takersOn(op.html).keys()])));
  for (const key of taken.keys()) if (!now.has(key)) taken.delete(key);
  for (const [key, a] of now) {
    const held = taken.get(key);
    if (held && carried && !carried.has(key)) continue;
    const holds = held && holding(held);
    if (!held || !("value" in holds!) || JSON.stringify(holds.value) !== a.props || held.doc !== a.doc || held.under !== a.under) taken.set(key, { ...a, ops: [] });
  }
}

/** A patch a member is told, as its applets on that document take it: passed over at or below the version their props hold, taken above it, and the version with it. */
export function taking(taken: Map<string, Taken>, message: { doc: string; version: number; ops: PatchOp[] }): void {
  for (const t of taken.values()) {
    if (t.doc !== message.doc || (t.v !== undefined && message.version <= t.v)) continue;
    t.ops.push(...message.ops);
    if (t.v !== undefined) t.v = message.version;
  }
}

/** What an applet holds now: its props with the ops it has taken laid on; or why the ops do not land. */
export function holding(t: Taken): { value: unknown } | { error: string } {
  try {
    return { value: applyPatch(JSON.parse(t.props), t.ops.map((op) => ({ ...op, path: t.under + op.path }))) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

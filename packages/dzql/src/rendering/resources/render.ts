import { WIRE, type WriteId } from "../json-patch";
import { splitTag } from "../parts";

/**
 * A page brought up to date in HTML's own terms (src/parts.ts works them out). `replace` morphs the
 * target element with `html` (one element); `tag` gives the target the attributes of `html`, an
 * opening tag, and leaves what is inside it alone; `after` and `before` put `html` beside the
 * target (a row into a list); `remove` takes the target out. The target is a part's selector,
 * `[data-eta-part="<key>"]`; a row taken out of a list while the page still carries its key
 * elsewhere (it moved, or is drawn twice) is named inside the list it left,
 * `[data-eta-part="<list>"] [data-eta-part="<key>"]`.
 */
export type HtmlOp = { op: "replace" | "tag" | "after" | "before"; target: string; html: string } | { op: "remove"; target: string };

/** A page sent whole says the wire it speaks (`WIRE`, src/json-patch.ts). */
export const renderMessage = (html: string): string => JSON.stringify({ type: "render", html, wire: WIRE });
export const fragmentsMessage = (ops: HtmlOp[]): string => JSON.stringify({ type: "render", ops });

// A page as the browser keeps it, laid on by what the server sends: the stories harness and a
// test's socket (test-socket.ts) hold a page so.

/** One fragment op applied to a page as the client applies it: the first element the selector names is replaced, put beside, or removed, or given a new opening tag. */
function applyOp(page: string, op: HeardOp): string {
  if (op.op === "tag") {
    // the part's opening tag, swapped as text, so the page reads exactly as a fresh render would
    const at = page.indexOf(op.target.slice(1, -1)); // `data-eta-part="<key>"`, as the tag carries it
    if (at < 0) return page;
    const start = page.lastIndexOf("<", at);
    const [old] = splitTag(page.slice(start));
    return page.slice(0, start) + op.html! + page.slice(start + old.length);
  }
  let done = false;
  return new HTMLRewriter()
    .on(op.target, {
      element(el) {
        if (done) return;
        done = true;
        if (op.op === "replace") el.replace(op.html!, { html: true });
        else if (op.op === "after") el.after(op.html!, { html: true });
        else if (op.op === "before") el.before(op.html!, { html: true });
        else el.remove();
      },
    })
    .transform(page);
}

/** A render op as a page hears it, parsed from the wire: an `HtmlOp`, its `html` read as it may be absent. */
export type HeardOp = { op: HtmlOp["op"]; target: string; html?: string };
/** A message from the server, as a page hears it. */
export type Heard = { type: string; html?: string; ops?: HeardOp[]; doc?: string; version?: number; id?: WriteId; reason?: string };

/** A member's open page after one more message: only renders change it. */
export function hear(page: string, message: Heard): string {
  if (message.type !== "render") return page;
  if (message.html !== undefined) return message.html;
  return (message.ops ?? []).reduce(applyOp, page);
}

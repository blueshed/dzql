/**
 * A page brought up to date in HTML's own terms (src/parts.ts works them out). `replace` morphs the
 * target element with `html` (one element); `tag` gives the target the attributes of `html`, an
 * opening tag, and leaves what is inside it alone; `after` and `before` put `html` beside the
 * target (a row into a list); `remove` takes the target out. The target is a part's selector,
 * `[data-eta-part="<key>"]`.
 */
export type HtmlOp = { op: "replace" | "tag" | "after" | "before"; target: string; html: string } | { op: "remove"; target: string };

export const renderMessage = (html: string): string => JSON.stringify({ type: "render", html });
export const fragmentsMessage = (ops: HtmlOp[]): string => JSON.stringify({ type: "render", ops });

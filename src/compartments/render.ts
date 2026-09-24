import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import { createEvent } from "./bus";

/**
 * A page brought up to date in HTML's own terms (src/parts.ts works them out). `replace` morphs the
 * target element with `html` (one element); `after` and `before` put `html` beside the target (a
 * row into a list); `remove` takes the target out. The target is a part's selector,
 * `[data-eta-part="<key>"]`.
 */
export type HtmlOp = { op: "replace" | "after" | "before"; target: string; html: string } | { op: "remove"; target: string };

// Fires whenever connections need their pages brought up to date: after a write to a document
// their page read, an undo, a presence change. Each is drawn again, and sent what differs.
export const renderRequested = createEvent<Iterable<ServerWebSocket<ConnectionData>>>();

export const renderMessage = (html: string): string => JSON.stringify({ type: "render", html });
export const fragmentsMessage = (ops: HtmlOp[]): string => JSON.stringify({ type: "render", ops });

import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import { createEvent } from "./bus";
import type { WriteResult } from "./compartment";

/**
 * A delta in HTML's own terms: what a render sends instead of the whole page when a compartment
 * can say which elements a write touched. `replace` morphs the target element with `html`
 * (one element); `add` appends `html` inside the target; `remove` takes the target out. The
 * target is a selector, in practice an id.
 */
export type HtmlOp = { op: "replace" | "add"; target: string; html: string } | { op: "remove"; target: string };

/** A write, as a render request carries it: the compartment that owns the document decides, per connection, what the write means for its page. */
export type RenderWrite = { docType: string; docId: string; result: WriteResult };

export type RenderRequest = { sockets: Iterable<ServerWebSocket<ConnectionData>>; write?: RenderWrite };

// Fires whenever a set of connections needs bringing up to date -- after a write to a
// document they see, an undo, a presence change. A bare iterable of sockets asks for a full
// render of each; a request that names the write lets the owning compartment answer with HTML
// ops instead (Compartment.fragments), or -- item 10's rule 2 -- falls back to a single replace
// of that compartment's own element rather than the whole page. The full render is the fallback
// only when there's no owning compartment's element to fall back to (a tray or ledger write).
export const renderRequested = createEvent<Iterable<ServerWebSocket<ConnectionData>> | RenderRequest>();

export const renderMessage = (html: string): string => JSON.stringify({ type: "render", html });
export const fragmentsMessage = (ops: HtmlOp[]): string => JSON.stringify({ type: "render", ops });

/** The element id a compartment's own place on the page lives at (item 10's rule 1). */
export const compartmentTarget = (docType: string): string => `c-${docType}`;

/** Wraps a compartment's rendered HTML in its keyed element -- what both a full render (each
 * compartment tried in turn) and a single-compartment re-render (rule 2's default) send. */
export const wrapCompartment = (docType: string, html: string): string =>
  `<div id="${compartmentTarget(docType)}">${html}</div>`;

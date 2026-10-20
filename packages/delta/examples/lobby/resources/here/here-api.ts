/**
 * Here: who is in the lobby, live. `here:lobby` is a memory document: its truth is this process,
 * gone on restart and never on a ledger. Nobody writes it over the socket (403): a page says who
 * it is with `join`, and the server writes it in, and out again when its socket goes. Beside it,
 * `colours:` is a static document, the colours a person may wear, fixed for the release.
 *
 * The types are shared: the page imports them as types only, so none of this reaches it.
 */
import { joinPath } from "@blueshed/delta/core";
import { registerMemory, registerStatic } from "@blueshed/delta/kinds";
import { createLocal } from "@blueshed/delta/local";
import { onClientDrop, registerMethod, type WsServer } from "@blueshed/delta/server";

export type Person = { name: string; colour: string };
/** What `here:lobby` holds: everyone in it, by the id of the socket they came on. */
export interface Here { people: Record<string, Person> }
/** What `colours:` holds. */
export interface Colours { colours: string[] }

export const COLOURS = ["tomato", "goldenrod", "seagreen", "steelblue", "orchid"];

/** The lobby, its colours, and `join`. */
export function hereApi(ws: WsServer): void {
  // A memory document takes writes from a caller in this process alone, and only createLocal()
  // makes one: so it is registered on both, the socket (who opens it) and the caller (who writes it)
  const local = createLocal();
  const both: WsServer = { ...ws, on: (action, handler) => (ws.on(action, handler), local.server.on(action, handler)) };
  registerMemory<Here>(both, { prefix: "here:", empty: () => ({ people: {} }) });

  registerStatic<Colours>(ws, { prefix: "colours:", value: (id) => (id === "" ? { colours: COLOURS } : undefined) });

  /** Out of the lobby: the socket has gone. */
  const leave = (client: any) => void local.call("delta", { doc: "here:lobby", ops: [{ op: "remove", path: joinPath("people", client.data.clientId) }] });

  // `join { name, colour }`: this socket is someone in the lobby until it goes (again: renamed)
  registerMethod(ws, "join", async ({ name, colour }, client) => {
    const person: Person = { name: String(name ?? "").trim() || "someone", colour: COLOURS.includes(colour) ? colour : COLOURS[0]! };
    const path = joinPath("people", client.data.clientId);
    await local.call("delta", { doc: "here:lobby", ops: [{ op: "add", path, value: person }] });   // an add over one there replaces it
    onClientDrop(client, leave);
    return { id: client.data.clientId };
  });
}

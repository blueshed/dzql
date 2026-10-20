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
import { onClientDrop, registerMethod, type WsServer } from "@blueshed/delta/server";

export type Person = { name: string; colour: string };
/** What `here:lobby` holds: everyone in it, by the id of the socket they came on. */
export interface Here { people: Record<string, Person> }
/** What `colours:` holds. */
export interface Colours { colours: string[] }

export const COLOURS = ["tomato", "goldenrod", "seagreen", "steelblue", "orchid"];

/** The lobby, its colours, and `join`. */
export function hereApi(ws: WsServer): void {
  // The pages open it; the server, which knows who is connected, writes it
  const here = registerMemory<Here>(ws, { prefix: "here:", empty: () => ({ people: {} }) });

  registerStatic<Colours>(ws, { prefix: "colours:", value: (id) => (id === "" ? { colours: COLOURS } : undefined) });

  /** Out of the lobby: the socket has gone. */
  const leave = (client: any) => void here.write("here:lobby", [{ op: "remove", path: joinPath("people", client.data.clientId) }]);

  // `join { name, colour }`: this socket is someone in the lobby until it goes (again: renamed)
  registerMethod(ws, "join", ({ name, colour }, client) => {
    const person: Person = { name: String(name ?? "").trim() || "someone", colour: COLOURS.includes(colour) ? colour : COLOURS[0]! };
    here.write("here:lobby", [{ op: "add", path: joinPath("people", client.data.clientId), value: person }]);   // an add over one there replaces it
    onClientDrop(client, leave);
    return { id: client.data.clientId };
  });
}

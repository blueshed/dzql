import { signal } from "@blueshed/railroad";
import { call, openDoc, type WsClient } from "@blueshed/delta/client";
import type { Colours, Here, Person } from "./here-api";

/** Who is in the lobby, live: the server writes it as people join and go. */
export const here = openDoc<Here>("here:lobby");

/** The colours to wear: fixed for the release, read once. */
export const colours = openDoc<Colours>("colours:");

/** Who this page is, once it has joined; and this socket's id in the lobby. */
export const me = signal<Person | null>(null);
export const myId = signal("");

/** Join the lobby as `person`. */
export async function join(person: Person, ws?: WsClient): Promise<void> {
  me.set(person);
  myId.set((await call<{ id: string }>("join", person, ws)).id);
}

/** On every connect: a socket that went has left the lobby, so a page that had joined joins again. */
export async function rejoin(ws: WsClient): Promise<void> {
  const person = me.peek();
  if (person) await join(person, ws);
}

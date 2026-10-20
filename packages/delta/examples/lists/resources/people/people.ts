import { signal } from "@blueshed/railroad";
import { call, openDoc, type WsClient } from "@blueshed/delta/client";
import type { People, Person } from "./people-api";

export { becomeAs, everyone, signOut, takeLink } from "@blueshed/delta/auth-link/client";

/** Who is at the page: undefined until the socket has said, then someone, or null for nobody. */
export const me = signal<Person | null | undefined>(undefined);

/** On every connect, before any document opens: who the socket is, by the cookie a link's tap (or a pick) set. */
export async function whoAmI(ws: WsClient) {
  me.set(await call<Person | null>("me", {}, ws));
}

/** Everyone here, live. Opened inside a view, it closes when the view goes. */
export const openPeople = () => openDoc<People>("people:");

/** A new link to be `person`, to send them: used once, for a week. */
export const linkFor = (person: number) => call<{ url: string; expires: string }>("link", { person });

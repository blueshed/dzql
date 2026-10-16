import { signal } from "@blueshed/railroad";
import { call, type WsClient } from "@blueshed/delta/client";
import type { Person } from "../people/people-api";

export { becomeAs, everyone, signOut, takeLink } from "@blueshed/delta/auth-link/client";

/** Who is at the page: undefined until the socket has said, then someone, or null for nobody. */
export const me = signal<Person | null | undefined>(undefined);

/** On every connect: who the socket is (its session cookie says, from the link tapped or the name picked). */
export async function whoAmI(ws: WsClient) {
  me.set(await call<Person | null>("me", {}, ws));
}

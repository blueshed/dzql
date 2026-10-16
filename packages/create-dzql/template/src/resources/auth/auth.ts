import { signal } from "@blueshed/railroad";
import { call, type WsClient } from "@blueshed/delta/client";
import type { Me, SignedIn } from "./auth-api";

const KEY = "{{name}}:token";

// The token this browser signs in with; a browser that keeps nothing signs in each visit
const kept = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const keep = (token: string | null) => {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {}
};

/** Who is at the page: undefined until the socket has said, then someone, or null for nobody. */
export const me = signal<Me | null | undefined>(undefined);

/** On every connect, before any document opens: sign in with the token this browser keeps. */
export async function signInAgain(ws: WsClient) {
  const token = kept();
  if (!token) return me.set(null);
  try {
    me.set(await call<Me>("authenticate", { token }, ws));
  } catch {
    keep(null); // run out, or signed out elsewhere: nobody until they sign in
    me.set(null);
  }
}

const signedIn = ({ token, ...who }: SignedIn) => {
  keep(token);
  me.set(who);
};

/** Register as someone new, and sign in. Refused, it throws what the server said. */
export const register = async (name: string, email: string, password: string) =>
  signedIn(await call<SignedIn>("register", { name, email, password }));

/** Sign in with an email and password. Refused, it throws what the server said. */
export const signIn = async (email: string, password: string) => signedIn(await call<SignedIn>("login", { email, password }));

/** Sign out, and start the page again as nobody. */
export async function signOut() {
  await call("logout").catch(() => {});
  keep(null);
  location.reload();
}

import { refuseOrigin } from "@blueshed/delta/server";
import { esc } from "./html";
import { sessionCookie } from "./server";
import type { Sessions } from "./sessions";

// A demo door: signing in by a link, one for each person, said as the server starts (`bun dev`) and
// listed for a demo's home page, so nobody needs an email or a password to get in. In development
// only: under NODE_ENV=production no link is said, listed or opened, and `say` says so in their
// place. A production app signs people in its own way (the dzql-app skill's reference/signin.md).
//
// Each link is used once and runs out (`ttl`, 15 minutes), and is kept as its token's hash. Opened
// (a tap, a preview, a page of another site's), it only asks: a page whose form posts it, from this
// site (its Origin), and the post starts a fresh session as that person -- never the visit's own --
// and sends the browser home. A person's link is the same until it is used or runs out, then
// another is made, so a page that lists them draws the same until one is used. The links are kept
// on globalThis, by the app's name for them, so `bun --hot` running the modules again keeps the
// ones it said.

/** A person a link signs in: their name, as the link is said, and what their session starts holding (who they are). */
export type Linked = { name: string; value: Record<string, unknown> };

/** What `say` says in production, in place of the links. */
export const DEMO_DOOR = "Sign-in links are a demo door, shut in production (NODE_ENV=production): no link is said, listed or opened. Sign people in another way (the dzql-app skill's reference/signin.md).";

type Kept = { links: Map<string, Linked & { expires: number }>; now: Map<string, string> }; // links by their token's hash; each person's link now, by name
const kept = globalThis as { __dzqlLinks?: Map<string, Kept> };

const production = (): boolean => process.env.NODE_ENV === "production";
const hashOf = (token: string): string => new Bun.CryptoHasher("sha256").update(token).digest("hex");

/** The page a link opens on: it asks, and its form posts the link. Never kept, never framed, and its address never sent on. */
const asking = (who: Linked): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in</title></head><body><form method="post"><p>Sign in as ${esc(who.name)}?</p><button type="submit">Sign in</button></form></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "frame-ancestors 'none'", "X-Content-Type-Options": "nosniff" } },
  );

/**
 * The links for `people`, under `key` (the app's name for them), each starting a session of
 * `sessions`, for an app served at `at` (its root when omitted). `route` is the app's
 * `"/in/:token"`; `say` is each person's link at a server's origin, to print as it starts; `ways` is
 * each person's name and path, for a page that offers a way in per person (a demo's home page).
 * `ttl` is how long a link lasts, in milliseconds.
 */
export function signInLinks(key: string, sessions: Sessions, people: () => Linked[], at = "", { ttl = 15 * 60_000 }: { ttl?: number } = {}) {
  const all = (kept.__dzqlLinks ??= new Map());
  const k = all.get(key) ?? all.set(key, { links: new Map(), now: new Map() }).get(key)!;
  const home = at || "/";
  const goHome = () => new Response(null, { status: 303, headers: { Location: home } });

  /** Each person's link now: the one they have, or a fresh one once it is used or has run out. */
  function current(): { name: string; token: string }[] {
    const now = Date.now();
    for (const [hash, link] of k.links) if (link.expires <= now) k.links.delete(hash);
    return people().map((p) => {
      let token = k.now.get(p.name);
      if (token === undefined || !k.links.has(hashOf(token))) {
        token = crypto.randomUUID();
        k.now.set(p.name, token);
        k.links.set(hashOf(token), { ...p, expires: now + ttl });
      }
      return { name: p.name, token };
    });
  }

  const ways = (): { name: string; path: string }[] => (production() ? [] : current().map(({ name, token }) => ({ name, path: `${at}/in/${token}` })));
  return {
    ways,
    say: (origin: string): string[] => (production() ? [DEMO_DOOR] : ways().map((w) => `${w.name}: ${origin}${w.path}`)),
    route: async (req: Bun.BunRequest<"/in/:token">): Promise<Response> => {
      const hash = hashOf(req.params.token);
      const who = k.links.get(hash);
      if (!who || who.expires <= Date.now() || production()) return goHome(); // no such link (used, run out, the server restarted): home, signed out
      if (req.method !== "POST") return asking(who);
      const refused = refuseOrigin(req); // posted from this site's own page
      if (refused) return refused;
      k.links.delete(hash); // once
      const { cookie } = await sessions.start(who.value);
      return new Response(null, { status: 303, headers: { Location: home, "Set-Cookie": sessionCookie(cookie) } });
    },
  };
}

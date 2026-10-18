import { sessionCookie } from "./server";
import type { Sessions } from "./sessions";

// Signing in by a link: one for each person, made as the server starts and printed where it starts
// (`bun dev`), so nobody needs an email or a password to get in. Opened, a link starts a fresh
// session as that person -- never the visit's own -- and sends the browser home; it lasts as long as
// the server. The links are kept on globalThis, by the app's name for them, so `bun --hot` running
// the modules again keeps the ones it printed. A person added later gets theirs at the next start.

/** A person a link signs in: their name, as the link is printed, and what their session starts holding (who they are). */
export type Linked = { name: string; value: Record<string, unknown> };

const kept = globalThis as { __dzqlLinks?: Map<string, Map<string, Linked>> };

/**
 * The links for `people`, under `key` (the app's name for them), each starting a session of
 * `sessions`, for an app served at `at` (its root when omitted). `route` is the app's
 * `"/in/:token"`; `say` is each person's link at a server's origin, to print as it starts.
 */
export function signInLinks(key: string, sessions: Sessions, people: () => Linked[], at = "") {
  const all = (kept.__dzqlLinks ??= new Map());
  const links = () => all.get(key) ?? all.set(key, new Map(people().map((p) => [crypto.randomUUID(), p]))).get(key)!;
  const home = at || "/";
  return {
    say: (origin: string): string[] => [...links()].map(([token, p]) => `${p.name}: ${origin}${at}/in/${token}`),
    route: async (req: Bun.BunRequest<"/in/:token">): Promise<Response> => {
      const who = links().get(req.params.token);
      if (!who) return new Response(null, { status: 303, headers: { Location: home } }); // no such link (the server restarted): home, signed out
      const { cookie } = await sessions.start(who.value);
      return new Response(null, { status: 303, headers: { Location: home, "Set-Cookie": sessionCookie(cookie) } });
    },
  };
}

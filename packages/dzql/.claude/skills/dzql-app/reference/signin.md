# Signing people in, and routes

A session is anonymous until the app says who it is. Sign people in **by a link**, one per person:
no email, no password. The `Example` it hangs on is [example.md](example.md); the model's page
(`src/modelling/page/signin.ts`) is a whole one.

```ts
// src/routes.ts (or the resource that keeps the people)
import { signInLinks } from "dzql/rendering/links";

const people = () => db.query("SELECT id, name, role FROM staff ORDER BY id").all()
  .map((p) => ({ name: p.name, value: { person_id: p.id, role: p.role } })); // what their session starts holding
export const links = signInLinks("cafe", sessions, people);                 // `sessions`: sessionRows(delta, "sessions")

export const app: Example = { …, routes: { "/in/:token": links.route as never } };

// as the server starts: a link per person, where `bun dev` prints
const server = serve(compose(appOf(app), modelling), { port });
console.log(["Signed in by a link:", ...links.say(server.url.origin).map((l) => `  ${l}`)].join("\n"));
```

- A link opened starts a **fresh** session as that person (never the visit's own, which a stranger
  could have planted) holding their `value`, and sends the browser home with its cookie. A link
  that is no link (the server restarted) goes home signed out. Links last as long as the server and
  survive `bun --hot`; a person added later gets theirs at the next start.
- For a demo, the home page is a way in for everyone: `links.ways()` is each person's `name` and
  `path`, an `<a href>` each, shown only while nobody is signed in. Someone who comes in another
  way (a code on a table, a public visitor) is a route of its own that writes their session, as
  `/in/:token` does.
- **Always a way out:** the bento's `leave` (`bento({ …, leave: { text: "Sign out", icon, path:
  "/person_id" } })`) removes who the session is, which every tab of the session hears.
- Who you are is the session's: its `permit` refuses changing it over the wire, but allows removing
  it (signing out).
- `/ws` refuses a socket opened from another site: allowed are no `Origin`, the page's own, or one in
  `ETA_ORIGINS`.
- Where the request itself says who it is (a proxy's header, the CLI's token), `Example.identify(req)`
  answers at `/ws` before it opens: a session, a `Response` that refuses, or undefined (a visit).
  Believe a header only with a secret only the proxy has. A person found keeps the cookie's session
  when it is already theirs, else gets a fresh one: never a visit's id signed in.
- delta's own `auth-link` (delta-doc's `auth.md`) is for a page that is delta's client; an app on
  `dzql/rendering` signs in as above.

## Only when the story asks for passwords

A route answering a plain form, so a password never crosses the socket. leave's
`examples/leave/signin.ts` is a whole one (passwords, a CLI token, a trusted proxy, slowing
guesses).

```ts
// examples/leave/signin.ts (trimmed)
export async function signIn(req: Request): Promise<Response> {
  const refused = refuseOrigin(req);
  if (refused) return refused;
  …
  if (!login || !matches) {
    if (visit) await tell(visit, { doc: "session", path: "/login", reason: "That email and password do not match." });
    return new Response(null, { status: 303, headers: { Location: "/" } });
  }
  return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": sessionCookie(await signedIn(login.person_id)) } });
}
```

The page: `<form method="post" action="/login">` with no `data-write`, so the client lets it post,
and `toldAt(sessionId, "session", "/login")` inside it ([refusal.md](refusal.md)). Refuse a post
from another site (delta's `refuseOrigin`); check a password against a hash in a table no document
includes; a good one starts a fresh session, a wrong one is told on the page it came from (`tell`
with a `reason`); a route that did what a form asked says so (`said`).

## In the stories

- `Stories.signIn(name)` gives the route and form for a member of the cast; the harness posts it and
  starts them from the page it signs them into. By links, it is their link's path:
  `signIn: (name) => { const way = links.ways().find((w) => w.name.toLowerCase() === name); return way && post(way.path); }`
  (the model's `src/modelling/page/stories.ts`); a visitor has none.
- `does: post(path, form)` posts as the author's browser does, follows the 303 as theirs, and checks
  `seen` and `untold`. No undo follows. The author's page must offer a plain
  `<form method="post" action="<path>">` with a field for each key, or the story says `offPage`.
- `cannot: post(...)` is a 4xx (its body the reason) or a `tell` with a reason, checked against `told`.

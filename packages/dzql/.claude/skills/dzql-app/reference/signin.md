# Signing people in, and routes

A session is anonymous until the app says who it is. **`signInLinks` is a demo door**: a link per
person, said as the server starts and listed on a demo's home page, so a story's cast, a demo or
a developer gets in with no email and no password. It is for development only: under
`NODE_ENV=production` no link is said, listed or opened, and `say` gives a line saying so in their
place. **A production app signs people in its own way** (*In production*, below). The `Example`
it hangs on is [example.md](example.md); the model's page (`src/modelling/page/signin.ts`) is a
whole one.

```ts
// src/routes.ts (or the resource that keeps the people)
import { signInLinks } from "dzql/rendering/links";

const people = () => db.query("SELECT id, name, role FROM staff ORDER BY id").all()
  .map((p) => ({ name: p.name, value: { person_id: p.id, role: p.role } })); // what their session starts holding
export const links = signInLinks("cafe", sessions, people);                 // `sessions`: sessionRows(delta, "sessions")

export const app: Example = { …, routes: { "/in/:token": links.route as never } };

// as the server starts: a link per person, where `bun dev` prints (in production, the line that says there are none)
const server = serve(compose(await appOf(app), modelling), { port });
console.log(["Signed in by a link:", ...links.say(server.url.origin).map((l) => `  ${l}`)].join("\n"));
```

Working: [examples/cafe](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/cafe/links.ts), the staff in by a link each (`links.ts`; the route,
and the links said as it starts, in `routes.ts`; a way in for each on the door in development,
`page.ts`; each asking, used once, and shut in production, `routes.test.ts`);
[examples/leave](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/leave/signin.ts), passwords, a CLI token and a trusted proxy (`signin.ts`).

- A link is used **once**, runs out (`signInLinks(key, sessions, people, at, { ttl })`, 15 minutes
  by default), and is kept as its token's hash, in memory: a link that is no link (used, run out,
  the server started again) goes home signed out. A person's link stays the same until it is used
  or runs out, then they have another, so a page that lists them is drawn the same meanwhile.
- **Opened, a link only asks**: a page of its own (never framed, never cached) whose form posts it.
  A link opened by another site's page, or by a chat's preview, signs nobody in; the post is
  refused from another site (its `Origin`). Posted, it starts a **fresh** session as that person
  (never the visit's own, which a stranger could have planted) holding their `value`, and sends
  the browser home with its cookie. The stories' `signIn` and the CLI's `login <link>` post it.
- For a demo, the home page is a way in for everyone: `links.ways()` is each person's `name` and
  `path`, an `<a href>` each, shown only while nobody is signed in, and empty in production, where
  the page draws no way in for staff. Someone who comes in another way (a code on a table, a
  public visitor) is a route of its own that writes their session, as the cafe's `/scan` does.
- **Always a way out:** the bento's `leave` (`bento({ …, leave: { text: "Sign out", icon, path:
  "/person_id" } })`) removes who the session is, which every tab of the session hears.
- Who you are is the session's: its `permit` refuses changing it over the wire, but allows removing
  it (signing out).
- `/ws` refuses a socket opened from another site: allowed are no `Origin`, the page's own, or one in
  `ETA_ORIGINS` (each taken as its origin; one that is none is reported).
- Where the request itself says who it is (a proxy's header, the CLI's token), `Example.identify(req)`
  answers at `/ws` before it opens: a session, a `Response` that refuses, or undefined (a visit).
  Believe a header only with a secret only the proxy has. A person found keeps the cookie's session
  when it is already theirs, else gets a fresh one: never a visit's id signed in.

## In production

`signInLinks` is shut there; sign people in by what the stories ask for, through a route of the
app's own that starts a fresh session (`sessions.start(value)`, its cookie by `sessionCookie`):

- **Passwords**, checked against a hash, by a plain form: below, and leave's `signin.ts`.
- **A proxy in front that knows who they are**, or a token: `Example.identify`, above (leave's).
- **Links sent by email**, kept as delta's `auth-link` keeps them (delta-doc's `auth.md`): only the
  token's hash, used once, running out -- its `LinkStore` (`sqliteLinkStore`, or on Postgres
  `postgresLinkStore` from `dzql/auth-link`), `hashToken` and `useLink`. delta's `linkAuth` itself
  is for a page that is delta's client; on `dzql/rendering` the link opens a route of the app's
  own that asks, as `signInLinks`' page does, and its post uses the link and starts the session.
  None of dzql's examples sends links yet.

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

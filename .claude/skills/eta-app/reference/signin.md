# Signing people in, and routes

A session is anonymous until the app says who it is. A route answering a plain form signs in, so a
password never crosses the socket. The `Example` it hangs on is [example.md](example.md); leave's
`examples/leave/signin.ts` is a whole one (passwords, a CLI token, a trusted proxy, slowing guesses);
OAuth2 and LDAP, not built, are sketched in eta's `docs/eta-app-notes.md`.

```ts
// examples/leave/signin.ts (trimmed)
async function signedIn(personId: string): Promise<string> {
  const sessionId = crypto.randomUUID(); // a fresh session, never the visit's own
  await serverWrite(`session:${sessionId}`, [{ op: "replace", path: "/sessions/person_id", value: personId }]);
  return sessionId;
}

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
and `toldAt(sessionId, "session", "/login")` inside it ([refusal.md](refusal.md)).

- Refuse a post from another site (delta's `refuseOrigin`). Check a password against a hash in a
  table no document includes.
- A good one starts a fresh session (never the visit's id), writes who it is with `serverWrite`, and
  answers `303 /` with `sessionCookie(id)` (`src/server.ts`). A wrong one is told on the page it came
  from (`tell` with a `reason`); a route that did what a form asked says so (`said`).
- Who you are is the session's: its `permit` refuses changing it over the wire, but allows removing
  it (signing out, which every tab of the session hears).
- `/ws` refuses a socket opened from another site: allowed are no `Origin`, the page's own, or one in
  `ETA_ORIGINS`.
- Where the request itself says who it is (a proxy's header, the CLI's token), `Example.identify(req)`
  answers at `/ws` before it opens: a session, a `Response` that refuses, or undefined (a visit).
  Believe a header only with a secret only the proxy has. A person found keeps the cookie's session
  when it is already theirs, else gets a fresh one: never a visit's id signed in.

## In the stories

- `Stories.signIn(name)` gives the route and form for a member of the cast; the harness posts it and
  starts them from the page it signs them into.
- `does: post(path, form)` posts as the author's browser does, follows the 303 as theirs, and checks
  `seen` and `untold`. No undo follows. The author's page must offer a plain
  `<form method="post" action="<path>">` with a field for each key, or the story says `offPage`.
- `cannot: post(...)` is a 4xx (its body the reason) or a `tell` with a reason, checked against `told`.

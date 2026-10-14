# Signing people in, and routes

A session is anonymous until the app says who it is. A route answering a plain form signs in, and
the password never crosses the socket. The `Example` it hangs on is [example.md](example.md).

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
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const login = loginOf.get(email);
  const matches = await Bun.password.verify(String(form.get("password") ?? ""), login?.hash ?? NOBODY); // as slow for an unknown email
  if (!login || !matches) {
    const visit = /(?:^|;\s*)session_id=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
    if (visit) await tell(visit, { doc: "session", path: "/login", reason: "That email and password do not match." });
    return new Response(null, { status: 303, headers: { Location: "/" } });
  }
  return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": sessionCookie(await signedIn(login.person_id)) } });
}
```

The page: `<form method="post" action="/login">` with no `data-write`, so the client lets it post,
and `toldAt(sessionId, "session", "/login")` inside it ([refusal.md](refusal.md)).

- Check the password against a hash in a table no document includes. Refuse a post from another site
  (delta's `refuseOrigin`). Slow someone who keeps guessing (leave: five tries, then once a minute).
- A good one starts a fresh session (never the visit's id), writes who it is with `serverWrite`, and
  answers `303 /` with `sessionCookie(id)` (`src/server.ts`).
- A route that does what a form asked says so as a success: `tell(visit, { doc, path, said })`.
- Who you are is the session's: its `permit` refuses changing it over the wire, but allows removing
  it (signing out, which every tab of the session hears).
- `/ws` refuses a socket opened from another site: allowed are no `Origin`, the page's own, or one in
  `ETA_ORIGINS` (comma-separated).

## Who you are, before the socket opens

Where the request says who it is (a sign-in proxy, the CLI's token), `Example.identify(req)` answers
at `/ws`, after the Origin check: the session to open (the kernel sets its cookie), a `Response` that
refuses it, or undefined (a visit, which signs in by the page). Leave's:

- `Authorization: Bearer <token>`: the person whose token it is, kept as its SHA-256.
- `X-Forwarded-Email` is believed only with the proxy's secret (`X-Proxy-Secret`); the proxy must
  overwrite both headers on every request.
- A person found keeps the cookie's session when it is theirs, else gets a fresh one; one not on the
  team is refused (403).

OAuth2 and LDAP plug in behind these same shapes and are not built: eta's `docs/eta-app-notes.md`.

## In the stories

- `Stories.signIn(name)` gives the route and form for a member of the cast; the harness posts it and
  starts them from the page it signs them into.
- `does: post(path, form)` posts as the author's browser does, follows the 303 as theirs, and checks
  `seen` and `untold` from delta's stream. No undo follows. The author's page must offer a plain
  `<form method="post" action="<path>">` with a field for each key, or the story says `offPage`.
- `cannot: post(...)` is a 4xx (its body the reason) or a `tell` with a reason, checked against `told`.

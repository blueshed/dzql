# eta-app notes: the why behind the skill

The eta-app skill (`.claude/skills/eta-app/`) says what to do. When it was cut to the standard in
`concise-skills.md` (14 Oct 2026), the reasons, the numbers and the sketches left it for here.
Nothing here is a rule the skill lacks.

## The wire

- **Compression.** The socket is permessage-deflate, which every browser offers, each message on its
  own, so no memory is kept per connection. A page crosses at a sixth to a quarter of its size, a
  patch at about two thirds. It costs CPU for each page a message goes to: about 2 µs a KB up to
  20 KB and 9 µs a KB past 32 KB (a 178 KB page, 1.6 ms). So a big page sent whole to many at once is
  the cost to watch.
- **Why no secret beside others' words.** As with BREACH: someone who can put text on a page and
  watch the encrypted sizes of what it is sent can guess a secret drawn in the same message.
- **Wire versions.** A page sent whole carries `wire` (`WIRE`, `src/json-patch.ts`: 2 since a write
  carries an id). A page from before ids sends none and is answered as it always was (its writes
  echoed without one, a refusal by the page whole, `refused` ignored), so a tab left open over a
  deploy keeps working. A page sent a page whole by a server of another wire (after a rollback)
  loads itself again, not twice in a minute; then it draws the page and says so in the console.
- **Order.** Events are handled one at a time, so an `inspect` is answered after everything the
  events before it set going.

## Undo

- The ledger is delta's (`delta_ledger`): every write with its inverse, its version, who made it,
  and the cursor Undo moves along, which is the session.
- A change's handle is random and the session's own, never delta's entry (a serial that counts
  everyone's writes); the server keeps the session's last 100 while it has a page open. A person
  and an assistant in one browser are one session, one cursor: "undo my last" would take whichever
  was newest, so each undoes its own by name.
- Chat's session is on the ledger, so Undo right after entering a room takes you out of it.
- `afterChange` runs one at a time because two runs at once diff the same copy, and delta refuses a
  remove or replace of what is not there (404) with the rest of the write: the second run's removes,
  and its adds with them.

## The page and its controls

- A watching applet's `data-v`: the server's copy moves before its change is told, so a render drawn
  after a change can come before its patch. A render is compared with the props the client holds,
  not the mount's attribute (still the first render's), so a page drawn afresh after the socket went
  is what it draws.
- After the socket goes, a write on its way may have landed. The page drawn afresh hands back what
  its form sent all the same (better there twice than lost), and each editing form says once any
  edit that page does not show.
- Escape and the back button send the editing form someone is in first, because WebKit fires no
  `focusout` for a field a render takes out: a drawer's words would be lost with it.
- The assistants' tools (`src/client/tools.ts`) cost 2.1 KB gzipped, for the app that imports them.

## Signing in, not built

OAuth2 and LDAP plug in behind the shapes leave uses (`examples/leave/signin.ts`):

- **LDAP** is a password checked elsewhere: the `/login` route binds as the person (a client such
  as `ldapts`, a new dependency to ask about) where leave calls `Bun.password.verify`; the rest is
  the same.
- **OAuth2 / OpenID Connect** is two routes: `GET /login` redirects to the provider with a `state`
  and a PKCE challenge kept in a short cookie; `GET /callback` checks the state, exchanges the code
  with `fetch`, verifies the id_token against the provider's keys (`crypto.subtle`, or `jose`, to ask
  about), finds the person by email or subject, then starts a fresh session and redirects home.
  `identify` is not needed: the cookie carries it from there.
- A proxy that does OAuth2 for the app (oauth2-proxy, Cloudflare Access) is `identify`'s header case.

## Apps outside eta

`Workshop/canyou-eta` is an app in a repo of its own that links eta from its checkout.

# Link sign-in for delta: the plan

> **A record.** Kept as it was written, for the history and the citations. How an app is made
> now is the root [README](../../README.md#how-an-app-is-made); where this differs from the code, the code is
> right.

*Written 16 October 2026, for Peter to agree before any code is written. Nothing has changed in any
repo yet.*

Peter: "in can you we created links for auth - and that worked well - can we add this to delta as an
alternative to jwt? It would make development a pleasure and not a desperate memory of email and
password."

## What it is

`@blueshed/delta/auth-link`: a `DeltaAuth` in which nobody types a password.

- **A link is someone.** It is a random token, kept only as its hash. It is used once, and lasts
  7 days.
- **A tap on the link makes a session.** The session is an HttpOnly cookie, kept as its hash. It
  lasts a year, and is renewed as it is used.
- **The socket is signed in by the cookie,** on upgrade (`onUpgrade`). No token ever rides in the
  socket's URL or in a message, which is the rule delta's auth contract was written around.
- **In development,** you become anyone in one click. The sign-in page lists the people, and
  `bun dev` prints a link for each.
- **jwtAuth stays** in dzql, for apps that need tokens elsewhere. Passkeys come later (below).

It is lifted from Can You? (`src/resources/auth/`, `src/resources/links/`,
`docs/answer-by-link.md`), where it has worked since 0.3.0. Only the general part moves: Can You?'s
asks, cards and team rules stay in the app.

## How a link works

1. **Someone's link is made:** by the app ("Send Sam's link", through the share sheet), by a
   command on the server, or by `bun dev` for each person. Its URL is `<site>/in/<token>`.
2. **Opening it changes nothing.** `GET /in/<token>` is the app's page. A chat's preview may fetch
   it, or even run it, and nothing is used.
3. **Sam's tap is what uses it.** The page POSTs `/api/in/<token>`, and the server checks the
   request comes from the site (`Origin`, as Can You?'s `fromSite`). The link is used, and a session
   is made: `Set-Cookie`, HttpOnly, SameSite=Lax, and Secure on https. The page takes the token out
   of the address bar.
4. **The socket opens signed in as Sam.** `onUpgrade` reads the cookie and finds the session.
5. **Sign out:** the `logout` action ends the session and clears the cookie, and the socket lets go
   of every document (as `jwtAuth` does).
6. **A link used or run out,** on a browser with no cookie, says so: "Ask for a new link." On one
   already signed in as that person, it just opens the app.

Links don't cancel each other: two people sending Sam a link at once never undo each other.

## Development: a pleasure

- **"Who are you?"** When `NODE_ENV` isn't production, the sign-in page lists everyone, and a click
  is a session as them. Nothing to remember; two windows are two people at once.
- **`bun dev` prints a link per person:** "Sam: http://localhost:3000/in/…". It's useful on a phone
  on the same network.
- **Tests sign in with `signInAs(server, person)`.** It answers a cookie for a fetch or a WebView,
  with no form and no hashing on every test.

Neither the picker nor `signInAs` exists in production: the server refuses them there, and a test
proves it.

## What delta gives, and what the app keeps

| delta's (`@blueshed/delta/auth-link`) | the app's |
|---|---|
| `linkAuth({ store, personOf, origin })`: a `DeltaAuth` with `onUpgrade`, `gate` and `logout` | who people are: a collection of its own (`people`), as documents read it |
| the routes, which the app spreads into `Bun.serve`: `GET /in/:token`, `POST /api/in/:token`, `POST /api/out`, and in development, `GET /api/dev/people` and `POST /api/dev/as/:id` | who may make whose link, and when (Can You?'s "anyone in the team, of anyone in it") |
| `makeLink(person, { opens? })`, answering `{ url, expires }` | what the link opens at (an ask, a page) |
| `signInAs` for tests | the page's words, and the share sheet |
| the tables `_auth_links` and `_auth_sessions`: hashes, the person's id, times | nothing about auth in its definitions |

**Where the tables live** follows the two engines:
- delta keeps them in SQLite (and the JSON file, for a first prototype);
- dzql keeps them in Postgres, made by `applyFramework`, as delta's own `_delta_*` tables are.

They are not documents. Nobody opens them, and they carry no person's data beyond an id.

## Security, briefly

- **Secrets are hashed:** 32 random bytes each, stored as SHA-256.
- **Links are used only by the tap,** a POST from the site, so a preview never uses one.
- **Sessions** are HttpOnly, so the page's script never reads them. SameSite=Lax, and the socket's
  upgrade checks `Origin` (delta's `refuseOrigin`).
- **A forwarded link is Sam,** until it is used or runs out (7 days). That is Can You?'s trade, and
  Peter chose it for a family app: "I don't want the overhead of security to be misplaced and stop
  usage." An app that needs more makes links shorter-lived, or adds passkeys.
- **Rate limits** on the POSTs, per address, as Can You? has them.

## Passkeys: later, optional

Can You? lets someone add a passkey whenever they like: the same person, now able to sign in on any
device, and on an iPhone's Home Screen (which keeps its own cookies apart from Safari's). That
brings `@simplewebauthn` and the passkey ceremonies, so I'd make it a second module,
`auth-passkey`, beside `auth-link` and sharing its sessions, once an app asks for it.

## The order

1. **delta:** `auth-link` with the SQLite store; Can You?'s tests carried over (link, tap, preview,
   used, expired, sign out, the socket); the development picker; `signInAs`. A minor release, on
   Peter's word.
2. **dzql:** the Postgres store, its tables in `applyFramework`; delta's auth cases run on it.
3. **create-dzql:** from `auth-jwt` to `auth-link`. Its tests sign in by picker, and lose the
   registration form.
4. **paintbrush:** an `auth` reference in the evolve skill, so the Shed's next run uses it in place
   of the passwords stage 5 wrote by hand.
5. **Can You?:** later, if wanted, onto delta's module. Its own code stays as it is until then.

About a day for 1 and 2, half a day for 3 and 4.

## Questions for Peter

1. **The first person in production.** Who signs in first, before anyone can send a link? I'd add a
   command on the server: `bun run link Sam` prints Sam's link (`railway ssh`). Or an `OWNER` email
   that the server sends a link to? That would need email, which nothing has yet.
2. **Who may make links.** Can You? says anyone signed in, for anyone. I'd make that delta's default
   and let an app narrow it (`mayLink(by, person)`).
3. **People.** The app's own collection, with `personOf(id)` reading it (recommended); or a people
   table of the module's own, so a new app has one without defining it?
4. **The JSON file.** Should `auth-link` work on the JSON file too, so a first prototype has sign-in?
   Or is sign-in a sign that the app has reached SQLite?

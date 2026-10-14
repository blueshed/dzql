# Feedback for eta

*14 October 2026. From building `cafe` on eta 0.53.0 (`bun create blueshed/eta`): the stories told
on the model's page while Blueshed watched, then the app built from them with the eta-app skill.
The result: 7 documents, 18 stories, 11 tests at 100% coverage of `app/`. Written by Claude, who
did the building.*

## What worked

- **The story harness is the best part.** Its failures say exactly what is wrong. "Refused and told
  X, but ann's page does not show it" said that a refusal no control offers should be silent.
  "A control the wire refuses" caught a button the browser would have broken on. 14 of 16 stories
  passed on the first run, and each fix was obvious from the message.
- **Modelling first, then building, works.** Writing the stories and documents on the model's page
  while the teller watched, then building from them, gave a small app that matches what was told.
- **The rules are simple to follow.** One document is shared by everyone who must see a change, and
  permit then shape decides each write. Sending only what changed, and never telling the wrong
  people, mostly followed from those two.

## Friction, with suggestions

### 1. A new row's id doesn't reach `afterWrite`

`afterWrite(ws, docId, ops)` gets the ops as the page sent them (`add /bills/-`), not as `shape`
made them (`add /bills/<uuid>`). "Start a bill and put me on it" (the bill in `table:<id>`, the
pointer in my session) needed a module-level `Map` to carry the id from `shape` to `afterWrite`
(`app/compartments.ts`, `started`).

*Suggestion:* give `afterWrite` the shaped ops as well, or the ids its echo carried.

### 2. Button values are always text

`write(doc, op, path, true)` draws `data-value="true"`, and the client sends the string `"true"`.
The stories send `true` and pass, because the harness compares `String(op.value)`. Two permits had
to accept both (the till's `/bills/<id>/paid`, the session's `/hide/<role>`). The harness warned
about the session's ("a control the wire refuses"). The till's was handled before any warning
could show, so whether it would have been caught was not tested.

*Suggestion:* typed values (JSON in `data-value`), or have the harness check a story's value as the
browser would send it.

### 3. The model CLI breaks on an apostrophe

`bun run cli:model story customer does ... the table's QR code ...` opened a shell quote, and the
next three commands were saved as one story's text, with no error.

*Suggestion:* refuse or warn on a newline in a story's words, or take the words from stdin.

### 4. The model can't be read from the CLI

`inspect` shows only a document's last change, so the whole model had to be read from SQLite
(`mdl_stories`, `mdl_documents`).

*Suggestion:* a `cli:model show` verb that prints the stories and documents as the page shows them.

### 5. `model:check --against-page` matches stories by their words

The model's stories are told in general terms ("A customer cannot order onto a bill that is paid");
the app's name a cast ("Ann cannot order onto a bill that is paid"). Every story came out as two
gaps, 41 in all, nearly all noise.

*Suggestion:* let an app story name the model story it tells (`model: 10`), and match on that when
it is there.

### 6. Test writes sent without an id get no refusal back

`write(ws, doc, ops)` from `src/test-socket.ts` sends no id unless given one. A refused write then
has nothing to answer, and the first server tests hung until bun's 5-second timeout.

*Suggestion:* have `write` give each write an id by default.

### 7. Nothing nudges you away from documents that grow forever

`kitchen:1` and `till:1` hold the whole cafe: every bill, order and line ever. It is the first
document you reach for, and every write redraws from all of it. Hiding what is done only hides it
on the page.

*Suggestion:* a short recipe in the eta-app skill for a document that holds only today's rows (a
scope by date, or a custom document of what is open).

### 8. Hiding what's done was hand-rolled

A toggle kept in the session (`/hide/<key>`, `patchCollections`) needed its own permit and shape
written out.

*Suggestion:* a small helper for a session's `shape` that applies `/reading`, `/filter` and `/hide`
writes and returns the ops.

### 9. The model page and the app share `db.sqlite`

It is harmless, thanks to the `mdl_` and `cafe_` prefixes, but surprising, and a reset of one is
a reset of both.

*Suggestion:* one line in the project's `CLAUDE.md`, or separate files by default.

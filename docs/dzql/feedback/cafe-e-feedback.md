# Feedback for the dzql maintainers: cafe-e

Built from `bun create dzql` (dzql 0.13.0, delta ^1.2.0, skills 0.53.0) with only the project's skills
and the library in `node_modules`. The cafe's story was told once, up front. The model reached
13 stories and 4 documents with every check closed. The app has 18 stories, 23 tests at 100%
coverage, and `bun check` clean. I also ran it by hand in Chrome: a customer scans, the manager
seats, the customer orders, the cook says ready, the manager places it, the customer pays.

"Seen" means it happened in this session; "read" means I found it in the code and worked around
it before it could bite.

## 1. The generated proof (`model/model.test.ts`) fails when a story both adds and removes a row (seen)

**What happened.** The manager's story 1 ("says what tables there are") had
`writes 1 add tables.seated=false remove tables`. Every check was closed and `dzql model` wrote
`model/`, but `bun test model/` failed 5 of 9 with `Row not found: tables/1`. The proof plays
each earlier story's writes as the premise for a later one, and story 1's premise is
`add /tables/-` followed by `remove /tables/1`. That deletes the row the store seeded, and the
next story then seats table 1.

**Repro.** Write one story that adds and removes an entity, and another that `requires` a field
of that entity. Close the checks, then run `bun test model/`.

**What I did.** I took the removal out of story 1, since the teller never said tables are taken
away. In other words, I changed the model to get around the generator.

**Fix to consider.** A premise should play only the writes the later story needs (the adds, and
the replaces that set what it `requires`). Or it should remove the row it just added, never row 1.
At the least, `model check` should refuse to write a proof that fails.

## 2. The scaffold runs `bun test` against the dev database (seen)

**What happened.** `tests.md` says "`.env.test` keeps the tests off the dev database", but
`bun create dzql` makes no `.env.test`. After a demo in `bun dev`, `bun test` ran the stories
against `db.sqlite` with the demo's data in it, and 9 stories failed. That is a false failure,
and the test run also writes into real data.

Also: the scaffold commits `db.sqlite`, `db.sqlite-shm` and `db.sqlite-wal` to git, and
`.gitignore` doesn't cover them. The README says the store is "a file in `data/`", which is
ignored, but `dzql/rendering/db` defaults to `db.sqlite` in the project root. So every `bun dev`
leaves the working tree dirty.

**Repro.** `bun create dzql`, build any app with a seed, use it in `bun dev`, then `bun test`.

**Fix to consider.** Ship `.env.test` with `DB_PATH=:memory:`. Default the database to
`data/db.sqlite` (or ignore `db.sqlite*`), and don't commit it.

## 3. There is no worked example of an app built from a model, guards and all (seen)

**What happened.** `reference.md`'s *From the model to the app* explains it in prose, but no
example under `examples/` calls `guardWrites`, imports `model/types.ts`, or runs the model's
migrations beside its own (`grep guardWrites examples` finds only the loader's tests). I put it
together from the prose and from leave:
- migrate with the model's schema, then createTables/migrateSchema with the app's;
- drop the model's `visit:` doc and register my own with `columns`;
- write an `actorOf` that reads the role from the visits table;
- pass `who` as the default.

It worked first time, but only because I read `guards.ts` and `sessions.ts` to be sure.

**Fix to consider.** One small example (or the starter, once it has a model) whose `delta.ts` is
exactly the steps the reference lists. That would have saved the most time of anything here.

## 4. The guards' refusal reaches a customer's page with the story's number (seen)

**What happened.** A refused write is told as `"<the model story's text> (story 5)"`, and that
text is what `toldAt` draws on the page. A manager sees "The manager cannot open an invoice on a
table that already has an unpaid one (story 5)". The number means nothing to a person, and for
the "nobody does another's job" stories the text is the modeller's phrasing, not words for them.

**Fix to consider.** Put the story number in a separate field for logs and the harness, and give
the page the words alone. Better still, let a story carry what its person is told (as an app
story's `told` already does).

## 5. `model:check --against-page` reports false gaps (seen)

After the app was built and all its stories passed, the read-back gave 9 gaps. Two were real, and
I fixed them (an app story tagged with the wrong `model:` number, and item 6 below). The rest
were not:
- **Holders compared by name.** "floor is held by cook, manager as told, by kit, mo as built:
  who holds it?" compares the model's roles with the cast's names, though the reference says
  "the model's teller is a role, the app's a cast member". It does this for every document.
- **The own document not found.** "visit was told, and the app has no such document." The app
  has it: a `perSession` resource with docType `visit`, root `visits`, as the reference says to
  build it.
- **`serves` mismatches.** For example, the floor doesn't "serve" the customer's paying story as
  built, although the manager's page changes on that write and the story's `seen` says so.

**Repro.** Run `bun run model:check --against-page` in this repository.

**Fix to consider.** Map cast members to roles (through `signIn`, or a `role` on the cast) before
comparing holders. Recognise the `perSession` resource as the own document. Derive `serves` from
the `seen` of the stories that name each model story.

## 6. No check saw that the customer must see being seated (seen)

**What happened.** Story 4 (the manager seats a table and opens its invoice) changes what the
customer at that table sees: their invoice opens. The customer's `table` document holds
`invoices`, but it didn't serve story 4, and every register was closed. Only the read-back
against the app (item 5) found it, because the harness saw the customer's page change.

**Fix to consider.** Subscription closure, or playability, could ask: a story writes an entity
that another person's document holds (`table` holds invoices), and that document doesn't serve
the story. Is that person told?

## 7. Generated migrations pile up while the model is still being told (seen)

**What happened.** `dzql model` writes a migration after every change while the checks are
closed. Modelling one afternoon left six: `001`–`005`, then `006-orders.ts`, an `addColumn` for
a price I added ten minutes after `005`. Nothing had shipped, but the files say "never edit"
and the app runs them all at start-up.

**Fix to consider.** Rewrite the newest unreleased migration in place until something marks it
released (a commit, a `dzql model release`). Or write migrations only when asked
(`dzql model --migrations`).

## 8. `writes <n> add <entity>.<field>=<value>` works, but isn't documented (seen)

**What happened.** A new table must start not seated, so that "seat it" (`requires
tables.seated=false`) has a write that sets that state. Precondition closure stayed open until I
found, in `examples/modeling/cli.ts`, that an add takes a field and value. The reference's verb
table only shows `add <entity>` and `replace <entity>.<field>=<value>`.

**Fix to consider.** One row in *The verbs*: `add invoices.paid=false`, the value a new row starts
with. Mention it in the precondition-closure message too ("no write sets it: an add may start it").

## 9. `sessionRows`' default lookup document is called `visit:`, the name the modelling skill gives each person's own document (read)

**What happened.** The model's own document was `visit` (root `visits`). The reference says to
keep it as the app's session. `sessionRows(delta, collection, visit = "visit:")` registers its
cookie lookup under `visit:` by default, so with the defaults the session document and the
cookie lookup would have shared a prefix. I passed `"cookie:"` as the third argument and saw no
failure, so I don't know how it would have failed.

**Fix to consider.** Default the lookup prefix to `cookie:`, or say in *From the model to the
app* that an own document named `visit` needs a different lookup prefix.

## 10. The harness throws when a cast member can't sign in, instead of reporting (seen)

**What happened.** Before `/login` existed, `bun run stories` ended in a stack trace
(`mo could not sign in at /login: 405`), with no story listed. Watching the first story fail is
step 1 of eta-app, and here it was a crash.

**Fix to consider.** Report every story as failed, with that sentence as the reason.

## 11. The scaffold's `server.test.ts` breaks as soon as `active` reads a document (seen)

**What happened.** The scaffold's test `expect(example.active("anyone")).toBe(false)` calls
`active` outside a render. Once `active` reads the session (as leave's does, and as every app
with people will), `read()` throws `Pending` there. So the first real `active` turns a scaffold
test red for a reason that has nothing to do with the app.

**Fix to consider.** Drop that test from the scaffold, or call `active` inside a scope as the
kernel does.

## 12. `show` prints the playability advice twice (seen)

**What happened.** After some changes, `bun run cli:model show` listed the advice block, then
listed `terminal-state` and `uneditable-field` advice again underneath, the second time with
fewer lines. It happened after `holds 1 orders under invoices item price:real status`.

**Fix to consider.** Print the advice once, from one source.

## 13. Smaller things

- **Seen:** Precondition closure doesn't ask who makes a document's root row (`cafes`). The floor
  and the menu are `implied: true`, so the app had to seed the cafe. That's fine, but the model
  doesn't say so.
- **Seen:** A guarded `cannot` story with `told` needs the reason drawn where its author stands.
  For "Kit cannot seat a table", the cook's page never offers seating, so I dropped `told`.
  Worth a line in `refusal.md`: a refusal from the guards with no control on the author's page
  can't carry `told`.
- **Seen:** In a test, `new WebSocket(url, { headers: { cookie } })` works under Bun, but the DOM
  type in `tsconfig`'s `lib` rejects `headers`, so I needed a cast. A `test-socket` helper that
  opens a page as a cookie would avoid that.
- **Read:** the installed `dzql` package contains every example (`chat`, `leave`, `ticker`), though
  its `files` lists only `examples/modeling`. That's because `node_modules` here links a
  workspace. With a published install, the examples the skills point to (`examples/leave/…`)
  wouldn't be there.

- **Seen:** eta-app's `signin.md` shows only email and password (leave's `signin.ts`), so an app
  built by eta-app alone gets passwords. Link sign-in, the obvious fit for a demo, is in delta-doc's
  `auth.md`, which I never opened while building, and its example is for delta's own `serve`, not
  an eta-app `Example`. The teller had to ask for links, and for a sign-out button: nothing told me
  every app with people needs one (bento's `leave` option does it in one line, once you know).
  Worth a line in `signin.md`: for a demo, a way in per person on the home page; and always a
  `leave`.

## Questions for the teller

I took the reading after each one and carried on (they're also in `todo.jsonl`).

1. May the manager take a table away, or rename one? *Took: tables are added, never removed or
   renamed.*
2. Must every item be placed before the customer may pay? *Took: no.*
3. Does scanning the code tell the manager who is waiting, or does the manager seat whoever is at
   the table? *Took: the scan only tells the customer's own page which table they're at; the
   manager seats the table.*
4. After a party pays and a new one sits at the same table, the first party's phone still names
   that table. Should it stop showing the table (their visit ends when they pay)? *Took: nothing
   ends it. They'd see the new party's invoice, which is probably wrong.*
5. Should a customer be able to undo paying? *Took: yes, like any write, since this app takes no
   real payment.*
6. Can a customer order before they're seated, or cancel an order before it's ready? *Took:
   ordering needs an open invoice; no cancelling.*
7. Does an order carry a quantity, or is each item one order? *Took: one order per item.*
8. How does each person come to be the manager, the cook or a customer, and how do they sign
   out? *Took, at first: staff sign in with an email and a password, with no sign-out. The teller
   then said it's a demo, so the home page now has a button for each of the staff and each table,
   with no passwords, and everyone has a Sign out.*
9. Is a table's code secret? *Took: no. `/scan?table=1` names the table, so anyone could order
   onto a table they aren't at.*

## The hints that would have helped most

1. An example app built from a model: `delta.ts` running the model's migrations, the guards in
   front, `actorOf`, and the own document kept as the session (item 3).
2. `add entity.field=value`, in the verb table (item 8).
3. `.env.test` in the scaffold, so `bun test` and a live demo don't fight (item 2).
4. "Don't write a story that both adds and removes the same entity until the proof handles it"
   (item 1).
5. "In a guarded app, `permit` says only *what* a page may send, and the guards say *who*." The
   reference does say this, but I only understood it from the harness's `may` call. Narrowing
   `permit` by role would have stopped the guards' words from ever reaching the page.

# eta's words: easier to grasp, understand, expect

*25 September 2026. Proposed, then applied the same day, all of it; `Resource` kept, by decision. Written after writing eta's `first-app.md`, which was the test: every word
that needed a footnote on the way in is below.*

## What makes a word hard

Writing the first-app path showed three kinds of trouble:

1. **One word, two meanings.** You learn one meaning, then meet the other and it misleads you.
   eta has four of these words: *Resource*, *tray*, *at* and *walk*.
2. **A name that doesn't say when it runs.** `permit`, `shape`, `walkable`, `wrote` and `changed`
   are all hooks on one object. Nothing in the names says which run before a write and which
   after, or who they run for.
3. **Two words for one thing.** Code says `sheet` and the docs say *drawer*. The same string is
   called *page*, *place*, *where* and *address*. The kernel says `refused` and `refuse` for two
   different things.

What a word should do: **say what the thing is for the person building, and say it once.** A
word from delta's inside (*walk*, *ledger*) is fine in delta, but it should not be the word an
app builder has to use.

## The proposal

Rows are grouped by how much they would break. The recommendation comes first; the reasons
follow the table.

### A. Two meanings: fix these first

| Now | Where | The trouble | Proposed |
|---|---|---|---|
| `Resource` in `src/tray.ts` | a cell of a box's grid | Same name as the kernel's Resource | **`Cell`** (bento already calls it `cell`) |
| `tray()` | lays out a box's grid | Same name as the session doc | **`grid()`** |
| "the tray" | the session's own document | Means two things; "session" is what every example names it | **say "session"**; `bento({ tray: "session" })` becomes `bento({ session: "session" })` |
| `Resource.at` | where eta's paths sit in the document (`/sessions`) | Same name as `Stories.at`, which puts a person somewhere | **`under: "/sessions"`** |
| `Stories.at(where)` | the write that puts a person at an address | Same as above | **`goTo(address)`** |

These are small breaks. `Cell`, `grid()` and `under` live in the kernel and a handful of examples,
and `goTo` is one line in each example's stories.

### B. The Resource's hooks: say when, and for whom

A resource answers four questions in order: may they write this, what does it become, may
they undo it, and what follows afterwards?

| Now | When it runs | Proposed |
|---|---|---|
| `permit(ws, op, docId)` | before a write: may they? | keep **`permit`** |
| `shape(ws, docId, ops)` | before a write: what it becomes | keep **`shape`** |
| `walkable(ws, docId, ops)` | before an undo or redo: may they? | **`permitUndo`** (it is `permit`, for Undo and Redo) |
| `wrote(ws, docId, ops)` | after a fresh write, for the writer | **`afterWrite`** |
| `changed(docId, ops)` | after any change, from anyone, undo included | **`afterChange`** |
| `own: true` | its documents are one per session | **`perSession: true`** |
| `resolveDoc(ws)` | which of these documents this person is on | keep; explain as "which one" |

With these names you can tell from the name alone which hooks run before and after.
`permitUndo` also removes *walk* from the API: it stays delta's word, not the builder's.

### C. Stories

| Now | What it means | Proposed |
|---|---|---|
| `seen` | whose page must change | keep |
| `unseen` | who must not even be *sent* the document | **`untold`**. "Unseen" reads like the opposite of `seen`, but everyone not in `seen` is already checked. This is the stronger check, and the harness itself already calls it `untold` |
| `outside: true` | the write comes from no page (a feed, the CLI) | **`offPage: true`** |
| `from` | where the author stands | keep |
| `told` | the reason a refused person is shown | keep |

### D. Two words for one thing: pick one

| Now | Proposed |
|---|---|
| `sheet(…)` in code, "drawer" in the docs and in `layers(page, drawer, modal)` | **`drawer(…)`** |
| page, place, where and address for the string `path?what=which` | **address**, everywhere: the `Stories.goTo(address)` argument, `seen`'s values and docs prose. *Page* then means only what `render` draws |
| `refuse(reason)` throws; `refused(sessionId, doc, path)` draws the line | keep `refuse`; **`reasonFor(sessionId, doc, path)`** draws it |
| `write(doc, op, path)` is a control; `writes([doc, path], …)` is an applet saying what it writes | **`appletWrites(…)`**. One letter apart is too close |
| the two ways an applet updates: `data-doc`, or props | name them in the docs: **on a document** and **from props** (first-app step 12 already does) |

### E. Keep, but explain better

- **`Resource`** (the kernel's). Once the grid cell is renamed, it has one meaning. The word
  still suggests a place on a page, though, which is the misreading the CLAUDE.md warns about.
  A rename (*Keeper*: "the keeper of room documents") would be the biggest break of all, since
  every example and every doc says it. So do A to D first, then see whether it still grates.
- **`kind: "fact"`**. Settled (Peter, 17 October: one namespace): delta's names, `memory`,
  `source`, `static`, stored when omitted; a fact is a stored document with `undoable: false`.
- **`active(sessionId)`**. It means "may this session write at all?" It is not about signing in
  (chat has no sign-in). Keep the name, and let its doc comment say that.
- **`ledger: false`**. Delta's word, but the builder only needs "Undo skips it". Keep.

## The writing, not only the words

The names are half of it. The doc comments and reference are written densely: long sentences
joined by dashes, where every clause is true and the reader has to hold all of it at once. As an
example, the comment on `Told.unseen` explains two checks in one sentence.

Proposed, for `reference.md` and each kernel doc comment:

1. **One plain sentence first**: what it is, then when you use it.
2. **Then one example**, from chat if it can be, or leave if not.
3. **Then the edges** (what it refuses, when it doesn't run), as short lines.

`first-app.md` is written this way, so it can serve as the pattern.

## If agreed, the order

1. A (the double meanings) with D's `drawer`, in one release, since both are kernel renames with
   old names kept as deprecated aliases for one version.
2. B and C, the hook and story renames, in the next, with the aliases again.
3. The reference rewrite (the section above), section by section.
4. Then look at `Resource` again.

Each rename is mechanical across `src/`, the four examples, the skill and the reference. The
gate (tsc, 100% tests, every example's stories) would catch any name missed.

## What was applied (25 September)

A to D as proposed, with the gate green (338 tests at 100%, stories 10/17/46/21). Where applying
them changed the plan:

- **The bento's own words stayed, and one moved.** *Tray* and *resource* were the bento's words
  before the kernel borrowed them: a box is a tray with resources cut into it. *Tray* is kept
  as the visual box, now that the session is no longer called that. The bento's *resource*
  became **cell**, in the code (`Cell`, `grid()`, `src/grid.ts`) and in the design rules, so
  *resource* is only the kernel's. The CSS tokens (`--tray`, `--radius-tray`) are unchanged.
- **Two more `at`s were found and renamed.** An applet's `data-at` (where its document sits in
  its props) is now **`data-under`**, the same idea as a resource's `under`. The browser-test
  helper `at(view, url)` is now **`urlFor(view, url)`**. A ledger entry's `at` (a time) stays.
- **No deprecated aliases.** eta is private and all its apps are its own examples, so aliases would
  have been complexity without a user. The CHANGELOG has a table from each old name to its new one.
- **The ticker's own `drawer(v)`** clashed with the new `drawer()`, and is now `openDrawer(v)`.
- **Doc comments rewritten** in the new pattern for `Resource`, `Kind`, `Stories.goTo`,
  `untold`, `Example.active`, `write`, `appletWrites`.
- **`reference.md` rewritten** in the pattern, section by section, with nothing dropped. Two facts
  in it were stale and are now right: "The ledger" still described delta 0.6.0's two limits
  (undo over a later write; no rule holding against Undo), both fixed since by delta 0.7.0's
  guarded undo and `permitUndo`; and "numbers for ids" contradicted "ids are text".
- **The CSS classes followed the words**: `.sheet`, `.sheet-head/body/foot/close/pic`,
  `@keyframes sheet-rise` and the examples' `*-sheet` names are `drawer`; `.walk-said` is
  `.undo-said`. Where "sheet" is English (a phone's bottom sheet, the wedding's dressing sheet) it
  stays.

### `Resource`: kept

With the bento's resource now a cell, the kernel's `Resource` has one meaning, and the test
that started this (writing `first-app.md`) needed no footnote for it: "a resource looks after
one type of document" reads plainly. A rename would move every example's `resources/` folder
and every doc for no gain in clarity. Revisit only if a newcomer misreads it.

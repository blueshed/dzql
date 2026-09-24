# CLAUDE.md

What a builder must not break. How the pieces work is in the eta-app skill
(`.claude/skills/eta-app/`), not here; the types in `src/` are the contract.

## Working here

- Bun only: never `node`, `npm` or `yarn`.
- Tests: `bun test`. `.env.test` keeps it off the dev database and `bunfig.toml` fails the run
  below 100% coverage.
- Verify every bug fix by reverting it, watching the new test fail, then restoring it.
- No new dependencies without asking. The one the examples have is `lucide`, the icon set; the
  kernel imports no icon set.

## Stories first

`stories.md` is what eta is for. An example's `stories.ts` says who does what and who then sees
it, and everything else is derived from it.

- Start a feature by writing the story: a person's intent, in a sentence a customer could call
  true or false. Run `bun run stories`. Then build the least that makes it pass.
- Build nothing no story needs. A story that describes tray state ("Ada opens the people, and only
  her page shows the window") instead of what a person wants is the sign a feature was invented
  first.
- Chat is the ten-line proof and stays that small: your name, a room, say something.

## The shape

- `src/` is the kernel. It does not know any example exists and never imports from `examples/`.
  Its tests may: `src/harness.test.ts` runs the harness against chat's stories.
- `examples/<name>/` is a whole app: its own documents (a `delta.ts`: its schema, seed and
  documents in delta), compartments, applets, client, and an `index.ts` exporting
  `example: Example`. Examples never import from each other; shared
  code is the kernel's or it is not shared.
- Before adding or extending an example, or touching the `Compartment` contract, an example's
  `delta.ts`, the applet registry or the wire, load the eta-app skill.
- Documents are delta's (`@blueshed/delta`, Workshop/docs/eta-on-delta.md): eta owns people and
  pages, delta owns documents, their ledger and their one stream of changes. `package.json` takes
  it from `../blueshed/delta`, a copy: after changing delta, `bun install --force`.

Two words have two meanings each, so say which:

- **Compartment.** The kernel's `Compartment` (`src/compartments/compartment.ts`) owns one
  `docType`: who sees its document, which writes are allowed, what a write becomes. It has no place on
  the page; the page is the example's one `render(sessionId)`. `src/tray.ts` also exports a
  `Compartment`: a cell in a box's grid, the bento's word for a place on a page.
- **Tray.** The session's own document (who you are, where you are) is what the docs call the
  tray; it is a compartment like any other. `tray()` in `src/tray.ts` lays out a box's grid.

## The wire

- HTML is the only vocabulary. No node or JSON tree on the wire or in the client.
- A write names a document and a JSON Pointer path, never a function name.
- A document is named whole on the wire, `<docType>:<docId>`, so one socket holds any documents;
  only a session's `own` documents go by their type alone, since the id is a credential.
- A connection sees what its page read: a page reads a document through `read("<docType>:<id>")`
  (src/documents.ts), and the kernel keeps what each drawing read. It is told about, and may write,
  only what it sees. So cut documents by who reads them: a page is told every change to one.
- The server is the only renderer. The client morphs; it never replaces `innerHTML`, and it never
  descends into a `[data-applet]` element.
- A page is sent in parts: after a write, each page that read the document gets only the parts of
  it that changed (`part(key, html)`, src/parts.ts), worked out by comparing, never hand-written; the
  whole page goes only when it is a different page.
- No client-side domain state beyond the small op-log in `window.eta.docs()`.
- A write from the wire is permitted, then shaped (the compartment's `shape`: the wire's ops as
  the document takes them), then written through delta as the person, with the session as the
  cursor undo walks. Delta applies it and its ledger entry in one transaction; every change is
  told from delta's one stream, in order, never by hand.

## Pages

A page follows the bento's rules, stated once in `examples/bento/README.md` and built in
`src/bento.ts` and `src/bento.css`. A page is a box (`boxPage`) or a collection (`collectionPage`).
Read the rules for what they intend, not as a checklist to satisfy.

Say a thing once. Nothing is shown twice on a page. In a list, what an item shares with the one
before it (its author, its day, its group) is said at the start of the run, not on every item;
what is true of the person looking (their own name on their own things) is not said to them at
all -- show it by place or colour instead. Repeating a label because it was easy is lazy. Where a bento rule and the
stories disagree, the stories win: rule 14 makes a new thing with a plus and a modal, but a modal
needs tray state, and chat's stories need none, so chat names a room in a form in place.

# CLAUDE.md

What a builder must not break. How the pieces work is in the eta-app skill
(`.claude/skills/eta-app/`), not here; the types in `src/` are the contract.

## Working here

- Bun only: never `node`, `npm` or `yarn`.
- Tests: `bun test`. `.env.test` keeps it off the dev database and `bunfig.toml` fails the run
  below 100% coverage, the client's too (src/client-coverage.ts). The browser tests (`webview()`,
  src/webview.ts) need Chrome or Chromium, on every platform: `BUN_CHROME_PATH` names it where it
  is not found (`/opt/chromium/chrome-shim.sh` in a sandbox that has staged one).
- The gate, before any commit that should ship: `bun check` (Bun's type check, TypeScript 7; Bun 1.4.3 or later), `bun test`,
  `bun run stories:all` (every example's stories). A release is `/publish`
  (`.claude/commands/publish.md`): eta's own, since a release is what `bun create` projects
  start from and carry across.
  Write what lands under `## [Unreleased]` in `CHANGELOG.md` as it lands, breaking changes first.
- Verify every bug fix by reverting it, watching the new test fail, then restoring it.
- `todo.jsonl` is the ledger of what is open. An item for a kernel bug that forced a workaround
  says what the workaround costs (bytes, time, or what the app gave up), so its priority shows.
- No new dependencies without asking. eta depends on `@blueshed/delta` (documents) and
  `@blueshed/railroad` (islands, `src/island.ts`: the one kernel file that imports it, and not
  the client's); the examples add `lucide`, the icon set; the kernel imports no icon set.

## Stories first

`docs/stories.md` is what eta is for. An example's `stories.ts` says who does what and who then sees
it, and everything else is derived from it.

- Start a feature by writing the story: a person's intent, in a sentence a customer could call
  true or false. Run `bun run stories`. Then build the least that makes it pass.
- Build nothing no story needs. A story that describes session state ("Ada opens the people, and only
  her page shows the window") instead of what a person wants is the sign a feature was invented
  first.
- Chat is the ten-line proof and stays that small: your name, a room, say something.

## The shape

- `src/` is the kernel. It does not know any example exists and never imports from `examples/`.
  Its tests may: `src/harness.test.ts` runs the harness against chat's stories, and a few of
  leave's, the wedding's and the ticker's for what only they have (a sign-in, an applet's
  declaration, a deadline passed, a row the tables lost).
- `examples/modeling/` is the model's page, and its `loader/` reads an app that exists: its
  documents (from its stories, its compartments and a run of them) and its stories as a hjeli model
  (`bun run model:check <example>`), and loads it into a model (`bun run model:load <example>`). It
  reads the kernel and the examples; nothing in them imports it. hjeli's model and predicates are a
  copy, in `examples/modeling/loader/model/`: eta depends on nothing outside itself.
- `examples/<name>/` is a whole app: its own documents (a `delta.ts`: its schema, seed and
  documents in delta), compartments, applets, client, and an `index.ts` exporting
  `example: Example`. Examples never import from each other; shared
  code is the kernel's or it is not shared.
- Before adding or extending an example, or touching the `Compartment` contract, an example's
  `delta.ts`, the applet registry or the wire, load the eta-app skill.
- Documents are delta's: eta owns people and pages; delta owns documents, their ledger and their
  one stream of changes. Its own README and skill (`delta-doc`, in
  `node_modules/@blueshed/delta/.claude/skills/`) say how it works. To try a change to delta
  before it is released, point `package.json` at a checkout (`file:../blueshed/delta`, a copy:
  `bun install --force` after each change) and put it back before committing.

One word, one meaning. Two used to have two, so they were renamed:

- **Compartment** is only the kernel's (`src/compartments/compartment.ts`): it owns one
  `docType`: who sees its document, which writes are allowed, what a write becomes. It has no place on
  the page; the page is the example's one `render(sessionId)`. A place in a box's grid is a
  **cell** (`Cell`, laid out by `grid()` in `src/grid.ts`).
- **Tray** is only the bento's: the box that cells are cut into. The visitor's own document (who
  you are, where you are) is the **session**, a compartment like any other.

## The wire

- HTML is the only vocabulary. No node or JSON tree on the wire or in the client.
- A write names a document and a JSON Pointer path, never a function name.
- A document is named whole on the wire, `<docType>:<docId>`, so one socket holds any documents;
  only a session's `perSession` documents go by their type alone, since the id is a credential.
- A connection sees what its page read: a page reads a document through `read("<docType>:<id>")`
  (src/documents.ts), and the kernel keeps what each drawing read. It is told about, and may write,
  only what it sees. So cut documents by who reads them: a page is told every change to one.
- The server is the only renderer. The client morphs; it never replaces `innerHTML`, and neither
  it nor a render in parts descends into a `[data-applet]` element. An applet may be an island, a
  railroad component (`island()`): it draws only inside its element and never binds that
  element's attributes, which are the page's.
- A page is sent in parts: after a write, each page that read the document gets only the parts of
  it that changed (`part(key, html)`, src/parts.ts), worked out by comparing, never hand-written; the
  whole page goes only when it is a different page.
- No client-side domain state beyond the small op-log in `window.eta.docs()`, and the document a
  watching applet holds (`appletProps(props, { doc, under })`), patched as delta sends it.
- A write from the wire is permitted, then shaped (the compartment's `shape`: the wire's ops as
  the document takes them), then written through delta as the person, with the session as the
  cursor undo walks. Delta applies it and its ledger entry in one transaction; every change is
  told from delta's one stream, in order, never by hand.

## Pages

A page's shape comes from its stories. The bento (`docs/bento/README.md`, Peter's words) is how
to check it: does a person know where they are and what they can do? It is a guide, not a
command; cite a story for a choice, never the bento. `src/bento.ts` and `src/bento.css` are the
kernel's defaults for drawing it, to use, change or leave.

Stop when you are splitting one thing across compartments, or adding one to fill a box: that is a
collection. Chat was once drawn as a box and showed the same thing in several compartments; it is
three collections -- a name, the rooms, a room -- and names a room in a form in place, since a
modal needs session state its stories never need.

Say a thing once. Nothing is shown twice on a page. In a list, what an item shares with the one
before it (its author, its day, its group) is said at the start of the run, not on every item;
what is true of the person looking (their own name on their own things) is not said to them at
all -- show it by place or colour instead. Repeating a label because it was easy is lazy.

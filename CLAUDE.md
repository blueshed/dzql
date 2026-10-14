# CLAUDE.md

What a change to eta must not break. How the pieces work is in the skills; the types in `src/` are
the contract.

## Which to load

- Stories still being told, before an app exists: the **modelling** skill (`.claude/skills/modelling/`).
- Building or extending an app or an example, or touching the `Compartment` contract, an app's
  `delta.ts`, the applet registry or the wire: the **eta-app** skill (`.claude/skills/eta-app/`).
- Documents, their schema and ledger: delta's **delta-doc** skill
  (`node_modules/@blueshed/delta/.claude/skills/`). An island: railroad's skill, beside it.
- A release: `/publish` (`.claude/commands/publish.md`). `bun create` projects start from a
  release and carry it across.

## Working here

- Bun only: never `node`, `npm` or `yarn`. No new dependencies without asking; the kernel imports
  delta, and railroad only in `src/island.ts`; the examples add `lucide`, and the kernel imports no icon set.
- The gate, before a commit that ships: `bun check`, `bun test --parallel` (100% coverage, the client's too),
  `bun run stories:all`, `bun run costs --check`. The browser tests need Chrome: the eta-app
  reference, *Tests*, says where it is found.
- Verify every bug fix by reverting it, watching its test fail, then restoring it.
- Write what lands under `## [Unreleased]` in `CHANGELOG.md` as it lands, breaking changes first.
- `todo.jsonl` is what is open. A kernel bug that forced a workaround says what the workaround costs.

## Stories first

`docs/stories.md` is what eta is for. An app's `stories.ts` says who does what and who then sees
it; everything else follows from it.

- Start a feature with its story: a person's intent, in a sentence a customer could call true or
  false. Watch it fail, then build the least that makes it pass.
- Build nothing no story needs, and never write a story to justify what is built. A story about
  session state instead of what a person wants is the sign a feature came first.
- Chat is the ten-line proof and stays small: your name, a room, say something.

## The shape

- `src/` is the kernel. It never imports from `examples/`; its tests may.
- `examples/<name>/` is a whole app with an `index.ts` exporting `example: Example`. Examples never
  import from each other: shared code is the kernel's or it is not shared.
- `examples/modeling/` is the model's page; its `loader/` reads an app that exists. Nothing imports it.
- Documents are delta's: eta owns people and pages, delta owns documents, their ledger and their
  one stream of changes.
- One word, one meaning: a **compartment** owns one `docType` (who sees it, which writes, what a
  write becomes) and has no place on the page; a place on the page is a **cell**, in the bento's
  **tray**; the visitor's own document is the **session**.

## The wire

- HTML is the only vocabulary. No node or JSON tree on the wire or in the client.
- A write names a document (`<docType>:<docId>`) and a JSON Pointer path, never a function name.
- A connection is told about, and may write, only what its page read (`read()`).
- The server is the only renderer. The client morphs, never replaces `innerHTML`, and never
  descends into a `[data-applet]`.
- After a write, each page that read the document gets only its changed parts, worked out by
  comparing; the whole page only when it is a different page.
- No client-side domain state beyond `window.eta.docs()` and a watching applet's document.
- A write is permitted, shaped, then written through delta as the person; every change is told
  from delta's one stream, never by hand. A change to what the wire carries bumps `WIRE`.

## Pages

A page's shape comes from its stories. The bento (`docs/bento/README.md`) is how to check it: does
a person know where they are and what they can do? Cite a story for a choice, never the bento.
`src/bento.ts` and `src/bento.css` are defaults, to use, change or leave.

Stop when you are splitting one thing across compartments, or adding one to fill a box: that is a
collection. Chat was once a box with the same thing in several cells; it is three collections.

Say a thing once. In a list, what an item shares with the one before it is said at the start of the
run; what is true of the person looking is shown by place or colour, not said.

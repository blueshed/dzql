# Stories (`stories.ts`)

How to write a story, the first thing an app is, and what the runner warns of. Tests beside the stories are [tests.md](tests.md).

A story is who does what, and who then sees it, as a sentence a customer could call true or false.
`docs/stories.md` at the root says why; `src/stories.ts` is the shape. Write it before anything else, run
`bun run stories`, and watch it fail.

- Build nothing no story needs. Do not write a story to justify something already built: one that
  describes the session's state ("opens the drawer") cannot fail and proves nothing. Tell what the
  person wants, and use `seen`'s place for where they must stand to see it.
- A refusal is a story too (`cannot`), and `told` is what its person is told.
- What a write, an Undo or a Redo did may be told to its author (`tell`, [*Saying why a write was
  refused*](compartment.md#saying-why-a-write-was-refused-or-what-one-did)). A story says what its undo must say with `undone: "Undone: your answer."` and its redo
  with `redone`; the harness compares the author's pages without the line, and checks it alone.
- `from` is where a person does it, so a control must lead there: build the button that opens the
  drawer or the modal with it, or the story fails (`no control leads ...`).
- A drag or a tap on an applet is the story's `gesture`: `{ drag: [from, to] }` or `{ press }`, CSS
  selectors on the page. `STORY_BY_HAND=1 bun run stories` does by hand, in a browser the size of a
  phone, each write a page sends and each refusal a control sends.
- A write before anyone holds a document (signing in) is `post(path, form)` ([*Signing people in*](example.md#signing-people-in));
  one from no page (a feed, the CLI) is `offPage: true`; what one story alone starts from is its
  `premise`.
- A story has a cost on the wire: `STORY_WIRE=1 bun run stories` says what its write, undo and redo
  handed each page, and its biggest part. A part far bigger than the write is a part cut coarser
  than what changes, or an applet handed its props whole where it could take patches (`data-doc`).
  `budget` (bytes before compression), on a story or on `Stories`, fails a page handed more.
- A write a compartment takes that no story tells and no page offers is a hidden verb, and `bun
  run stories` warns of it, by its document: `session: a write no story tells and no page offers
  / ada may add /name`. Permit the writes the stories make: narrow the `permit`, or leave it wide
  on purpose and say why beside it (the ticker's "anyone may type a tick"). Never write a story
  to quiet it.

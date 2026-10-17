# Stories (`stories.ts`)

Write the story first: who does what, and who then sees it, as a sentence a customer could call
true or false. Then `bun run stories`, and watch it fail.

```ts
// examples/chat/stories.ts (trimmed)
const name = (value: string): Write => ({ doc: "session", ops: [{ op: "replace", path: "/name", value }] });
const room = (value: string): Write => ({ doc: "session", ops: [{ op: "replace", path: "/room", value }] });
const say = (text: string): Write => ({ doc: "room", ops: [{ op: "add", path: "/messages/-", value: text }] });

export const stories: Stories = {
  cast: { ada: [name("Ada"), room("general")], bob: [name("Bob"), room("general")], cy: [name("Cy"), room("kitchen")], eve: [] },
  budget: 4608,
  stories: [
    story("Ada says hello; Bob, in the room, sees it; Cy, in the kitchen, does not", { as: "ada", does: say("hello"), seen: ["ada", "bob"], untold: ["cy", "eve"] }),
    story("Without a name you cannot enter a room", { as: "eve", cannot: room("general") }),
  ],
};
```

The shape is `Story` and `Stories` in `src/modelling/stories.ts`; `docs/stories.md` says why.

- Build nothing no story needs, and never write a story to justify what is built. One that
  describes the session's state ("opens the drawer") cannot fail: tell what the person wants.
- A refusal is a story too (`cannot`); `told` is what its person is told ([refusal.md](refusal.md)).
- `undone` and `redone` say what an Undo or Redo must tell its author (`undone: "Undone: your
  answer."`); the harness compares pages without the line, and checks it alone.
- `from` is where a person does it, and a control must lead there: build the button that opens the
  drawer, or the story fails (`no control leads ...`). Places are addresses ([bento.md](bento.md#where-you-are-the-address)).
- A control counts only where a person could press it: not `disabled`, `inert`, `hidden` or in a
  disabled fieldset, itself or by what it is in. A story told from a modal is done in the modal.
- An applet's control is the story's `gesture`: `{ drag: [from, to] }` or `{ press }`, CSS
  selectors. `STORY_BY_HAND=1 bun run stories` does each write and refusal by hand, in a browser the
  size of a phone.
- A write before anyone holds a document (signing in) is `post(path, form)` ([signin.md](signin.md));
  one from no page (a feed, the CLI) is `offPage: true`; what one story alone starts from is its
  `premise`.
- `STORY_WIRE=1 bun run stories` says what each write, undo and redo handed each page, and its
  biggest part. `budget` (bytes before compression), on a story or on `Stories`, fails a page handed
  more. A part far bigger than its write is cut too coarse ([page.md](page.md)), or an applet is
  handed its props whole ([applets.md](applets.md)).
- `seen` compares pages; it does not look for a word. That a value is drawn, check in a server test
  ([tests.md](tests.md)).
- A `cannot` story can pass before anything is built, when `permit` already refuses the write: let
  the write through for a moment, watch the story fail, then put the rule back.
- A write a compartment permits that no story tells and no page offers is a hidden verb, warned of
  by document: `session: a write no story tells and no page offers / ada may add /name`. Narrow the
  `permit`, or leave it wide on purpose and say why beside it. Never write a story to quiet it.

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

A story with no body yet, `story(name)`, goes in `Stories.unproven`: the harness reports it
unproven, never failed, and a test named from it tells it until it has a body
(`` test(`${stories.x.name} -- ...`) ``; `untold(stories, sources)` lists any no test names). That is
how a paintbrush app keeps its stories, so one format grows from there to here.

- Build nothing no story needs, and never write a story to justify what is built. One that
  describes the session's state ("opens the drawer") cannot fail: tell what the person wants.
- A refusal is a story too (`cannot`); `told` is what its person is told ([refusal.md](refusal.md)).
- `undone` and `redone` say what an Undo or Redo must tell its author (`undone: "Undone: your
  answer."`); the harness compares pages without the line, and checks it alone.
- `from` is where a person does it, and a control must lead there: build the button that opens the
  drawer, or the story fails (`no control leads ...`). Places are addresses, each member's tab's
  own ([bento.md](bento.md#where-you-are-the-address)).
- A link, a bookmark or a reload is `opensTab: "<address>"`: the author opens another tab of their
  session at that URL, which must stand there, while the tab they had (`from`) stays where it was;
  `seen` names who notices it opening. Leave's: `{ as: "mo", opensTab: "2026-10?request=1", seen: [] }`.
- A control counts only where a person could press it: not drawn `disabled`, `inert` (behind an
  open window or modal), `hidden`, in a `<template>`, or in a disabled fieldset (but for its first
  legend), itself or by what it is in, which ends where HTML says it does, end tag or none (a `<li>`
  with no `</li>` ends at the next). This is the rule wherever dzql asks it -- the stories, by hand
  and as told, and an assistant's tools ([assistants.md](assistants.md)); the browser's code says it
  once, `pressable` in `src/rendering/client/form-value.ts`. A story told from a modal is done in the modal.
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
- `seen` is everyone **whose page changes**, not everyone who holds the document: the cook's
  kitchen does not change when a table is set up, so the cook is not in its `seen`.
- In a `seen` record, `""` is the page with no address: where a signed-out member stands
  (`{ ann: "", mo: "list" }`).
- An app built from a model writes its own stories, each naming its model story (`model: n`): a
  cast of named people with `signIn`, documents by type, writes its pages really send.
  `bun run stories` runs on a throwaway database unless `DB_PATH` says one.
- To watch several people at once in one browser, give each a host of their own (a session is a
  cookie per host): `localhost:3000`, `127.0.0.1:3000`, `kitchen.localhost:3000`.
- `seen` compares pages; it does not look for a word. That a value is drawn, check in a server test
  ([tests.md](tests.md)).
- A `cannot` story can pass before anything is built, when `permit` already refuses the write: let
  the write through for a moment, watch the story fail, then put the rule back.
- A write a resource permits that no story tells and no page offers is a hidden verb, warned of
  by document: `session: a write no story tells and no page offers / ada may add /name`. Narrow the
  `permit`, or leave it wide on purpose and say why beside it. Never write a story to quiet it.

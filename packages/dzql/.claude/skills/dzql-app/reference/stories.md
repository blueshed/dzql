# Stories (`stories.ts`)

Write the story first: who does what, and who then sees it, as a sentence a customer could call
true or false. Then `bun run stories`, and watch it fail on its own terms
([below](#watch-it-fail-on-its-own-terms)).

```ts
// examples/chat/stories.ts (trimmed)
const name = (value: string): Write => ({ doc: "session", ops: [{ op: "replace", path: "/name", value }] });
const room = (value: string): Write => ({ doc: "session", ops: [{ op: "replace", path: "/room", value }] });
const say = (text: string): Write => ({ doc: "room", ops: [{ op: "add", path: "/messages/-", value: text }] });

export const stories = {
  cast: { ada: [name("Ada"), room("general")], bob: [name("Bob"), room("general")], cy: [name("Cy"), room("kitchen")], eve: [] },
  budget: 4608,
  stories: {
    adaSaysHello: story("Ada says hello; Bob, in the room, sees it; Cy, in the kitchen, does not", { as: "ada", does: say("hello"), seen: ["ada", "bob"], untold: ["cy", "eve"] }),
    noNameNoRoom: story("Without a name you cannot enter a room", { as: "eve", cannot: room("general") }),
  },
} satisfies Stories;
```

The shape is `Story` and `Stories` in `src/modelling/stories.ts`; `docs/stories.md` says why.

Working: [examples/chat](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/chat/stories.ts), the stories above, whole (`stories.ts`);
[examples/leave](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/leave/stories.ts), a cast signed in by a form, and tabs opened at a URL
(`opensTab`); [examples/cafe](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/cafe/stories.ts), each story naming its model story
(`model: n`), the cast in by its links, a `premise` per story;
[examples/wedding](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/wedding/stories.ts), `undone` and `redone`. An undo refused as a story:
none in the examples. Undo with nothing to take back is refused without a word, so told from a page
that offers Undo it is a control that always fails, and the harness says so: it is told from a page
with no Undo on it (`bento.md`, *Undo follows the role*). `bun run stories:all` tells every example's.

Each story is under a key of its own. One with no body yet, `story(name)`, sits among the rest:
the harness reports it unproven, never failed, and a test named from its key tells it until it
has a body (`` test(`${stories.stories.x.name} -- ...`) ``; `untold(stories, sources)` lists any
no test names). That is how a paintbrush app keeps its stories, so one file grows from there to
here: a story gaining its body is the same line, under the same key.

- Build nothing no story needs, and never write a story to justify what is built. One that
  describes the session's state ("opens the drawer") cannot fail: tell what the person wants.
- A refusal is a story too (`cannot`); `told` is what its person is told ([refusal.md](refusal.md)).
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
  one from no page (a feed, the CLI) is `offPage: true`.
- What one story alone starts from is its `premise`: writes by named members of the cast, each as
  that member, made after the cast's and before the story, in the order written, and rolled back
  with it. Each must change something. It is for a state the cast does not have and every other
  story should not (an order already placed, a deadline passed). The cafe's:
  `story("Ann orders Soup ...", { premise: { mo: seats(1) }, as: "ann", from: "menu?item=1", does: order(1, 1), seen: ... })`.
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
- A write a resource permits that no story tells and no page offers is a hidden verb, warned of
  by document: `session: a write no story tells and no page offers / ada may add /name`. Narrow the
  `permit`, or leave it wide on purpose and say why beside it. Never write a story to quiet it.

## Watch it fail on its own terms

A red that is not a story's proves nothing. `Cannot find module './src/links'` is a file not
made yet, not a story failing.

- Make what `stories.ts` imports first, the least that loads (the cast's `links.ts`, a resource
  listed in `routes.ts` with nothing in it). The first red must be a story's own: `no control on
  their page`, `nothing landed`, `refused, but it landed`, a page that did not change.
- A story that passes before anything is built -- a `cannot` that `permit` already refuses, an
  `opensTab` the app already stands on -- is made to fail for a moment: let the write through, or
  send the address somewhere else, watch the story fail, then put it back.

## Undo, in the stories

The harness undoes and redoes every `does` story that lands on the ledger, as its author. After
the undo every page must be as it was before the write; after the redo, as it was after. So the
stories already prove Undo for every write: an Undo feature needs no story of its own.

- `undone` and `redone` say what an Undo or Redo must tell its author (`undone: "Undone: your
  answer."`); the harness compares pages without the line, and checks it alone.
- A write off the ledger (a session's), one that is never undone (`undoable: false`, a tick), or
  one whose author has gone (logged out) is not undone. An `undone` there fails.
- An undo as a write is `walked("undo")` (`dzql/rendering/json-patch`): `{ doc: "ledger", ops: [{
  op: "remove", path: "/latest" }] }`; a redo is `walked("redo")`, `add /latest`.
- Tell one as a story only where a walk is refused: `cannot: walked("undo")`, its `premise` the
  write to take back and what stands in the way, `told` the refusal's words. The wedding's
  Okafors, their answer given and the deadline then passed, would be told "Answers closed at the
  deadline." (`permitUndo`, [refusal.md](refusal.md#undo-is-checked-before-it-runs)):

  ```ts
  story("Once the deadline has passed, the Okafors cannot undo the answer they gave before it", { as: "okafors", premise: { okafors: [household("replace", "/answer", "maybe")], couple: [board("replace", "/deadline", "2026-01-01")] }, cannot: walked("undo"), told: "Answers closed at the deadline." })
  ```
- An undo that meets someone's later change is refused in the kernel's words: `told: "Someone has
  changed that since, so it cannot be undone."`. Where writes only add rows, nobody's change can be
  in the way: say so, and write no such story.
- An undo with nothing to take back is refused without a word. So where a person who writes
  nothing on the ledger is offered Undo, their `cannot: walked("undo")` fails as a control that
  always fails: give Undo only to those who write ([bento.md](bento.md#undo-follows-the-role)).

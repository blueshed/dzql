# Your first app

This is the way in: what to write, in what order, and the words you meet at each step. Each
word is explained when it is first used, and not before. The first app is chat, the smallest
example, and the code here is taken from it, shortened where chat does more (paging back through
earlier messages, for one): `examples/chat/` is the whole of it. After step 7 the path follows leave, the
example with sign-in, a calendar and drafts, for the things a bigger app needs.

If you only remember one thing, remember this: **write the story first, and let the failure tell
you what to build next.**

## What you are building

An eta app is one Bun process and one SQLite file.

- Its data lives in **documents**: a named shape of rows, like `room:general` (a room and its
  messages). A document is stored by [delta](https://www.npmjs.com/package/@blueshed/delta).
- The **server draws every page**, as HTML, for one person at a time. The browser only swaps in
  the parts that changed. There is no data kept in the browser.
- A person changes a document with a **write**: a document, a path in it, and a value. Every
  write can be undone.
- **Stories** check that it all works: who does what, and who then sees it.

## 1. Write the story

Make `examples/<name>/stories.ts`. A **story** is one thing a person wants, in a sentence that
could be true or false. It says who does it, the write they make, and who then sees it.

```ts
// examples/chat/stories.ts
story("Ada says hello; Bob, in the room, sees it; Cy, in the kitchen, does not", {
  as: "ada",
  does: say("hello"),        // the write: { doc: "room", ops: [{ op: "add", path: "/messages/-", value: "hello" }] }
  seen: ["ada", "bob"],      // whose page must change
  untold: ["cy", "dee", "eve"], // who must not even be sent it
}),
```

- **cast**: the people in your stories, and the writes that set each of them up first.
- **seen**: everyone whose page changes. Everyone else in the cast is checked *not* to notice, so
  a story names everyone who sees it.
- **cannot**: a write that must be refused, like `story("Without a name you cannot enter a room",
  { as: "eve", cannot: room("general") })`.

Run it, and watch it fail:

```bash
ETA_EXAMPLE=chat bun run stories
```

A failure is a sentence, like `bob did not see it` or `ada has no control on their page for add
/messages/- on room`. Each one tells you what to build.

## 2. Say what your documents are

`examples/<name>/delta.ts` holds the tables and the documents.

```ts
// examples/chat/delta.ts
export const schema = defineSchema({
  sessions: { table: "chat_sessions", columns: { name: "text?", room: "text?" }, temporal: false },
  rooms: { table: "chat_rooms", columns: {}, temporal: false },
  messages: { table: "chat_messages", parent: "rooms", columns: { name: "text", text: "text", sent_at: "integer" }, temporal: false },
});
registerDocs(delta.server, db, schema, [
  defineDoc("session:", { root: "sessions", include: [], implied: true }),
  defineDoc("room:", { root: "rooms", include: ["messages"], implied: true }),
], [], { ledger: true });
```

- A document is named `type:id`, like `room:general`. `root` is its row; `include` is the rows
  under it.
- `ledger: true` records every write with its opposite, which is what makes Undo work.
- **An id is said as text** on the wire and in a document's name. A new row's id is a serial
  number (delta names it), a session's may be a token, so never `Number()` an id.

## 3. Read a document

`examples/<name>/documents/<thing>.ts` turns a document into what your page needs.

```ts
// examples/chat/documents/room.ts
export function read(name: string, limit = 50): ChatMessage[] {
  const messages = Object.values(readDoc(`room:${name}`)?.messages ?? {});
  ...
}
```

Reading a document while drawing a page does something important: **that page is now told about
every change to it.** You never subscribe by hand. So cut your documents by who reads them.

## 4. Draw the page

`render(sessionId)` returns the whole page as HTML. A control says what it writes with
`write(doc, op, path, value?)`:

```ts
// examples/chat/resources/session.ts
`<form${write("session", "replace", "/name")}>`,
`<input id="name" name="name" required>`,
```

- A **form** writes the value of its field (or a record of its fields) when it is submitted.
- A **button** writes on click, with its `data-value` if it has one, with its type: `true`, not `"true"`.
- Wrap a region in `part(key, html)` when a change should send that region alone.

## 5. Say who may write what

A **Resource** (`src/rendering/resources/resource.ts`) looks after one type of document. (Chat's
is written here on one line per hook; the real file spells them out.)

```ts
// examples/chat/resources/room.ts
export const room: Resource = {
  docType: "room",
  resolveDoc: (ws) => sessionDoc.read(ws.data.sessionId).room ?? undefined, // which room this person is in
  permit: (ws, op) => op.op === "add" && op.path === "/messages/-" && sessionDoc.read(ws.data.sessionId).name !== null, // may they?
  shape(ws, _room, ops) {                                                       // what the write becomes
    const { name } = sessionDoc.read(ws.data.sessionId);
    return ops
      .map((op) => String(op.value ?? "").trim())
      .filter((text) => text !== "")
      .map((text): PatchOp => ({ op: "add", path: `/messages/${Bun.randomUUIDv7()}`, value: { name, text, sent_at: Date.now() } }));
  },
};
```

- **permit** answers yes or no for each change in a write.
- **shape** turns what the page sent into what the document keeps: an id made, the author added,
  a blank value dropped. If it returns nothing, the write is refused.
- A write the browser can refuse first (`required`, `pattern`) should be refused there.

Both run before a write. The other hooks are named for when they run too: `permitUndo` before an
undo or redo (step 10), `afterWrite` after a fresh write, for the writer, and `afterChange` after
any change from anyone. Chat's room uses `afterChange` to keep the list of rooms.

## 6. Put it together

`examples/<name>/index.ts` exports the example:

```ts
// examples/chat/index.ts
export const example: Example = {
  name: "chat",
  resources: [session, room, here, lobby], // the session's first; here and lobby are live, kept by the server
  render,
  active: (sessionId) => sessionDoc.read(sessionId).name !== null, // may this person write at all?
  index,                                                           // client/index.html
  delta,
};
```

Run it and open it:

```bash
ETA_EXAMPLE=chat bun run dev
```

## 7. Run the stories until they pass

```bash
ETA_EXAMPLE=chat bun run stories
```

What the common failures mean:

| Failure | What it means |
|---|---|
| `X did not see it` | The write landed, but X's page did not change. Does their page read the document? |
| `X noticed, and should not have` | X's page changed and the story didn't say so. Name X in `seen`, or stop showing it to X. |
| `after the story, X was told of doc, and should not have been` | X is in `untold`, and their page reads that document. Cut the document smaller. |
| `X has no control on their page for …` | No button or form on X's page sends that write. Build it, or say where X stands (step 8). |
| `nothing landed: X's write was refused` | Check `permit` and `shape`. |
| `refused, but X was not told "…"` | The story expects a reason (`told`), and the page does not show it (step 9). |
| `X could not be put on "…"` | The story stands X somewhere your app refuses to go. |
| `undo did not restore: X's page differs` | Undo left something different. Is part of the change stored outside the ledger? |

Once they pass, add a server test for anything a story cannot see, and keep `bun test` at 100%.

## 8. Where people are

Chat has one page. Most apps have several, plus drawers and modals, and that is where the
**session** comes in: each visitor's own document, holding where they are.

- Its resource says `perSession: true`: it belongs to one session, and is named on the wire by its
  type alone, because the session id is a credential.
- It says `ledger: false`: moving about is not history, so Undo skips it.
- Where you are is one **address**: `path?what=which`, like `2026-10?request=1` in leave, the
  October calendar with request 1's drawer open. It goes in the URL, so the back button works.

Your stories say how to put someone at an address, once: leave's is
`goTo: (address) => ({ doc: "session", ops: [{ op: "replace", path: "/page", value: address }] })`.
Then a story says where each person stands, `seen: { mo: "2026-10?request=1" }`, and where the
author acts, `from: "2026-10?draft"`, which puts them where the control is. The harness checks
that they really got there, so a place your app does not have is a failure, not a silent pass;
and that a person could have, by the buttons on their pages from where the cast put them (Next,
then the Ask tool), so a drawer or a modal nothing opens is a failure too.

## 9. Saying no, and why

When a person can make a write that must be refused, tell them why:

```ts
// examples/leave/documents.ts
if (ends < starts) throw refuse("The last day is before the first.");
```

Draw the reason beside the control that sent it: `toldAt(sessionId, doc, path)` gives the line.
The story then says `told: "The last day is before the first."`. A plain `false` from `permit`
refuses without a word; that is right for a write no page offers.

## 10. Undo

Undo and redo are free: every write is recorded with its opposite. Three things to know:

- If Undo must obey a rule of time or state (answers close at a deadline), add `permitUndo` to the
  resource. It is asked before an undo, and may refuse with a reason.
- Where what Undo changed may be out of sight (a drawer that is shut), say what it took back:
  `afterWalk` runs after an undo or redo, knowing which way it went, and `tell`s the line the kernel
  draws beside Undo. The story then says `undone: "Undone: your answer."`, and `redone` for the
  redo (the wedding's).
- **One Undo reverses one write to one document.** If a gesture changes two documents, Undo takes
  two presses. So keep what changes together in one document. Where it cannot be, say what follows
  in the hooks: leave's draft is its asker's alone, in their session, until they ask; asking drops
  it (`afterWrite`), and its Undo gives it back (`afterWalk`).

## 11. Signing people in

Leave shows the whole thing. A password must never be a write (it would sit in the browser's log),
so:

1. The sign-in page is a plain `<form method="post" action="/login">`, with no `data-write`.
2. A route on `Example.routes` checks the password with `Bun.password.verify`, starts a *new*
   session, writes who it is into that session with `serverWrite`, and sets `sessionCookie(id)`.
3. The session's `permit` refuses changing who you are over the wire, but allows signing out.
4. In the stories, `signIn(name)` gives the route and form, and the harness signs the cast in
   through it.

Where who you are comes with the request -- a sign-in proxy in front, the CLI's token --
`Example.identify(req)` says so before the socket opens: the session to use, or a refusal. Leave's
is in `examples/leave/signin.ts`.

## 12. When you need an applet

Draw everything on the server until something must keep state that a redraw would destroy: a
drag halfway through, a scroll position, a chart's history. That piece is an **applet**
(`src/rendering/applets.ts`): client code that draws inside one element.

- It sends its own writes with `ctx.send(doc, ops)`.
- Its mount says exactly what it writes, `appletWrites(["team", "replace", "/requests/*/starts"], …)`
  (`*` is any one segment: the request's id), so the stories can find the control.
- Its data comes from a document it watches, and its props say only what to show and for whom:
  `appletProps({ open, reveal, everyone }, watch("everyone:1", "/everyone"))` puts the document in
  its props at `under`, beside the small ones, and says the version it holds. Each change to the document reaches it as
  a patch, laid on its props by the kernel's client, and it is given them again (`update`); the
  mount is not sent again for it. So it derives what it draws from its props with a pure function,
  which the server runs too, for what the mount declares and a first paint (the wedding's photo of
  everyone, `crowd`). Props with no document go again whenever they change: keep those small.
- Test the drawing as a pure function, and the gestures in a real browser (`Bun.WebView`),
  pressed as a mouse presses (`press`, src/rendering/webview.ts), never with `element.click()`.

## Things that bite

- **Stories name everyone who sees.** A page that changes for someone not in `seen` fails.
- **Ids are text.** Always.
- **A watched document is drawn whole into the page.** Watch one cut for who reads it, with no
  secret in it.
- **One Undo is one document.** Keep a gesture's changes in one.
- **Don't edit `src/` for one app.** If it seems you must, read the eta-app reference's "When it looks
  like you need to touch the kernel" (`.claude/skills/eta-app/reference/where-an-app-lives.md`) first:
  a missing seam is rare.

## Where next

- `docs/dzql/modelling/stories.md`: why eta is shaped this way.
- `.claude/skills/eta-app/reference/`: every part, one short file a part (its `SKILL.md` says which
  for which step); `docs/dzql/rendering/eta-app-notes.md` has the why.
- `docs/dzql/rendering/bento/README.md`: the bento, a guide to where am I and what can I do.
- `examples/leave/`: sign-in, a calendar applet, drafts, and a manager's rules, in about 1,000 lines.

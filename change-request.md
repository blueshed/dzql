# Change request: what the wedding asked of the kernel

*14 September 2026. Written after building `examples/wedding/` (0.23.0), the second example on
eta. Nothing here blocked the wedding; each is a place where the example did work the kernel
could do once, or where the kernel's vocabulary ran out and the example improvised. Numbered so
the changelog can name them.*

## Where this comes from

The wedding went in without a new seam in `src/`. That is the good news, and it is the reason
the requests below are small: the kernel's shape is right, and these are the places where a
second example rubbed. The first example (chat) has one shared document and two pages; the
wedding has three documents, nine pages, four drawers, and four applets, and the difference in
scale is what showed these.

## 1. Who sees a document

**What.** A concept says which connections see a document, and the kernel does the echo and
the re-render.

**Why.** Today every concept that broadcasts keeps its own registry of live sockets. Chat's
room concept keeps a map of room to sockets; the wedding keeps a set of every socket in
`concepts/presence.ts` and filters it by reading the session document per socket
(`seeingHousehold`, `seeingBoard`). Both are the same job written twice, and both re-render by
emitting `renderRequested` with whatever set they computed. The wedding's answer -- "everyone"
-- is right for a wedding and wrong for anything larger, and there is no place in the kernel
to say a better one.

**How.** A `Concept.sees?(ws, docId): boolean` (or `audience(docId)`) and a kernel-kept set of
open sockets. After `write` or `replay`, the dispatcher echoes the patch to every socket whose
concept says it sees the document, and pushes a render to the same set, so a concept's `write`
returns `{version, applied}` and nothing else. `rendered` on `WriteResult` goes, since the
kernel now knows who it rendered. `renderRequested` stays for the cases a document write does
not cover (presence changes on open/close).

**Not this.** Not a subscription protocol on the wire. The client never says what it watches;
the server knows from the session.

## 2. Forms that edit

**What.** A form can write on blur or on change, not only on submit; and a form with several
fields can write several paths in one message.

**Why.** The client's form contract is built for creating: one field, or a record, on submit,
reset on the echo. The wedding's keep drawers edit: a gift's name, its words, its link, each
its own path. That meant one form and one Save button per field, and a record form cannot be
used because a record lands at one path. The apples version wrote each field on blur; people
expect that of a property panel.

**How.** Two attributes, both optional. `data-write-on="blur"` (or `"change"`) on a form
submits it when a field loses focus, instead of on Enter. `data-write` on a *field* inside a
form names that field's own path; the form's submit then sends one op per such field whose
value changed, as one `{doc, ops}` message. The reset-on-echo rule stays as it is for forms
that create; an editing form should not reset, since its value attribute is the document's and
the morph keeps it current -- so `data-write-on` also turns the reset off.

**Not this.** Not a client-side dirty tracker. The comparison is against the field's `value`
attribute, which the last render wrote.

## 3. Where a tab is

**What.** The page a tab is on lives in the URL, not only on the session document.

**Why.** The wedding keeps the page (`household/asks`, `households/3`) on the session, so going
somewhere is a write and the server renders the result. That is honest to the architecture and
it works, but the browser's back button does nothing, a link cannot be shared, and two tabs of
one household are forced onto the same page, which is a stranger sharing than sharing the
household's answer. Chat's `room` on the session is the same choice at a smaller scale and it
grates less there.

**How.** The smallest version: the kernel client mirrors a `data-page` attribute on `#app`'s
first child (or a `<meta>` in the render) into `history.pushState`, and on `popstate` sends the
session write the example declares for it (`data-page-write`). The session document keeps the
page, so a reload still lands where the tab was; the URL just follows. The larger version -- the
kernel resolving the page from the request path -- is a different architecture and not asked
for here.

## 4. Coverage that counts applets

**What.** The applets' mounting code shows in the coverage table as what it is.

**Why.** `bun test --coverage` sees a file only when a test imports it in-process. Chat's
`room-picker.ts` is never imported that way, so it is absent from the table and the total reads
100% without it. The wedding's applets *are* imported (their drawings are strings, tested
directly), so their `mount`/`update` halves show as uncovered even though `client/app.test.ts`
drives every one of them in a real browser. Either way the number is wrong; the wedding's way
is at least wrong out loud.

**How.** Two honest options. (a) Split each applet into its drawing (imported, measured) and
its mounting (imported only by `client/main.ts`, unmeasured, like room-picker), and say in
`CLAUDE.md` that mounting is covered by the browser tests and not by the table. (b) Collect
coverage from the browser: `Bun.WebView` cannot report it today, so this waits on Bun. Take
(a) now and keep the 100% aim meaning what it says.

## 5. Session writes and the ledger

*Done, 0.25.0: the sentence is in `concepts/concept.ts`'s `write()` doc comment and in the
skill's reference.md ("Opting a write out of the ledger"), now with a second real example
besides the wedding's session document -- chat's own presence ops (item 8) are off the ledger
the same way.*

**What.** A document can say it is not the ledger's.

**Why.** The wedding's `session` document (the code, the page, the open drawer) records nothing
on the ledger, because Undo means "take back my last answer", never "go back a page". Today
that is a `patch()` that simply never calls `record()`, and `inspect` reports it at version 0
forever. Chat records its session writes, so undoing there can re-join a room. The two examples
disagree and the kernel has no word for the choice.

*Half done, 0.26.0:* the ledger gained the other word, `record(..., undoable: false)`, for a write
that is a fact (a price tick): on the ledger, never under Undo. The unrecorded case below is still
only a convention.

**How.** Nothing to build; a sentence in `concepts/concept.ts` and the skill: a document whose
`patch()` does not record is off the ledger by design, its version is always 0, and undo never
lands on it. If the kernel ever grows a flag, `Concept.ledger?: false` is the shape.

## 6. The picture route is an example's, and should stay one

**What.** No change. Recorded so nobody adds one.

**Why.** The wedding stores uploaded bytes in its own `pictures` table and serves them from its
own `/pictures/*` route; the key that lands on a row is a plain document write, undoable like
any other. That used `Example.routes` exactly as intended and needed nothing generic. A kernel
"assets" seam would be a solution to a problem one example has once.

## 7. The delta, in HTML's terms

*Done, 0.24.0, and measured (README, "Cost").* The history in the changelog shows the cause:
0.4.0 had `append`, undo (0.11.0) needed a word for removing an element, and 0.12.0 answered by
removing the granular vocabulary rather than adding the word. `Concept.fragments` brings it back
with `replace`, `add` and `remove`, the full page as the fallback. What it does not do: an
applet's props go whole, and every connection is still asked (item 1). Two small follow-ups
the wedding shows: the board concept declines everything, and a fragment that names a target the
page no longer has is skipped rather than answered with the page.

## 8. The wire says less than the page: presence and history

*Done, 0.25.0.* Both halves landed as described below, plus one thing the "How" didn't say: the
announcing socket is excluded from its own presence echo (it's about to get a full render of the
room it just joined/left anyway), which as a side effect means a solo join into a fresh room, or
a redundant tab closing while another of the same session's tabs remains, now sends nothing at
all rather than a wasted re-render.

**What.** Presence becomes a document write, and a document's history can be asked for over the wire.

**Why.** Someone entering or leaving a room reaches every other connection as a full render with
no op: the room concept keeps a socket registry and asks the room to re-render. That breaks the
rule that a write names a document and a path, and it means a watcher on the wire (the CLI's
`watch`) never sees arrivals or departures. The wedding copied the same registry
(`concepts/presence.ts`). Separately, a watcher that joins late sees only what happens next:
`inspect` reports a document's head, not its transcript, and the only way to read what was
said before is a render, which the CLI never touches.

**How.** Presence: the room concept applies `add /people/-` and `remove /people/<index>` to the
room on join and leave, and echoes them like any other op; not on the ledger (undoing an arrival
is nonsense), which makes item 5 concrete. With item 7 in place the echo renders the people chips
as a fragment instead of the page. History: `inspect` takes a `limit`, and answers with that many
ledger entries per document instead of the head alone, so a watcher can catch up before it watches.

## 9. The patch itself, into an applet

*Done, 0.26.0, and measured (README, "Cost").* Item 7 sent the delta as HTML; for an applet whose
props are a document's subtree, the delta is already the update, and the HTML was the change sent
twice. `Applet.patch` with `data-doc` on the mount: the client hands the echo to the applet, the
concept's `fragments` says nothing follows. A tick on the ticker is 104 bytes to each viewer against
41 as a bare feed. What it does not do: an applet still gets whole props when they change by a
fragment (item 7's caveat), and the client's kernel does not yet apply an op to props for the
applet -- each applet does its own, which is right while there are two of them.

## 10. The words: tray, compartment, tools

*Done, 0.27.0, in the two commits rule 5 asked for.* Rule 3's "the tray renders the ground" turned
out to mean something specific once built: the tray has no `render` at all (nothing for the
kernel to wrap), so whatever it used to show before a code/name existed -- chat's name form, the
wedding's welcome -- moved into whichever domain compartment is tried first (`room.ts`,
`household.ts`); that compartment's own wrapper is the page in that state, exactly as rule 1
allows. One thing the contract didn't say: a compartment's wrapper is a DOM/morph boundary, not a
layout one, and chat's CSS relied on `.messages` being a direct flex child of `#app` -- fixed
with `[id^="c-"] { display: contents; }`, now documented in the skill for the next example that
hits it. `Example.tray` is optional; the ticker (no sign-in) has none.

**What.** Bento is eta's page model, and the kernel says so in its names. The code unit now
called a *concept* becomes a **compartment**: a document with a place on the page, where it shows
its state. The session becomes the **tray**: the ground the compartments sit on, holding which
page a tab is on, which drawer is open, how a collection is read. Undo, redo and leave are
**tools**: verbs beside the compartments, on the box, not in it. Applets keep their name: a piece
of behaviour inside a compartment.

**Why.** Three reasons, in order of weight. It says where a thing lives, where "concept" only says
that something is owned; and every example is already a box of compartments -- the ticker's clock,
watchlist and market; the wedding's guests, asks, gifts, the day, where to stay, everyone; chat's
room, with the session's welcome filling the page before it. It names what the examples are. And
it keeps a stranger from bringing React with them: "component" means a client-side thing owning
its state, re-rendering itself, composed by a parent passing props down -- everything eta is not.
"Compartment" refuses all of that in one word, and the thing in eta that does resemble a component,
the applet, keeps its own name, so the line stays sharp: a compartment is where a document is
shown; an applet is behaviour inside one.

**How.** A rename, and two things that follow from taking the name seriously. `Concept` becomes
`Compartment` (`src/concepts/` becomes `src/compartments/`, `concepts: [...]` on `Example`
becomes `compartments`); the skill and CLAUDE.md follow. Then: a compartment renders into a keyed
element, so a write to its document re-renders that element by default -- which is most of item 1
falling out of a name, and the natural unit for item 7's fragments. And the odd ones out become
honest: the ledger has no compartment (it is the tools' document, not a place), and the session is
the tray, not a compartment, so neither is "a concept with no render" any more.

**Not this.** Not a component model. A compartment holds nothing in the browser and composes
nothing; the box does the composing and the render does the filling.

**The contract**, for whoever builds it:

1. A compartment's `render(sessionId)` returns the HTML of its own place on the page, or
   `undefined` to defer, as `Concept.render` does today. The kernel wraps what it returns in
   `<div id="c-<docType>">` and the page is the compartments in order. A compartment may still
   return the whole page (the welcome, before a code): it is then the only one rendered, and its
   wrapper is the page.
2. After a write to a document, the kernel re-renders the owning compartment's element for every
   connection that sees the document (item 1's audience; `renderRequested` with the write, as
   now) as a single `replace` of `#c-<docType>` -- unless the compartment answers `fragments`
   itself, in which case its answer stands, `[]` included. So `fragments` becomes the exception,
   not the rule, and the default cost of a write is one compartment, never the page.
3. The tray is the session: it renders the ground (the crumbs, the tools, the drawer that is
   open) and is not a compartment; the ledger renders nothing and is not one either. Both keep
   the same contract minus `render`, and `Example.compartments` lists only compartments.
4. `WriteResult.rendered` goes. A write's own connection is rendered by rule 2 like any other;
   nothing is rendered twice.
5. Do the rename first, as its own commit, the full suite green and nothing else changed; then
   rules 1 to 4 as a second commit, with chat and the wedding as the proof and the ticker's
   measured numbers unchanged (a tick still renders nothing).

## Order

5, 7, 8, and 10 are done. 11 next, as the same sitting's third commit: it touches only the
documents, which 10 did not move. 1 for what 10 leaves (a document seen by more than its own
tray) -- with 10 done, a compartment that renders into a keyed element is the audience question
answered for the common case, and with 7 in place it is what turns "nothing to send" into "nobody
to ask". 2 after that: it is the thing a person editing the wedding's lists feels. 4 is a
morning's tidy. 3 is worth doing only if a third example wants links.

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

**What.** A document can say it is not the ledger's.

**Why.** The wedding's `session` document (the code, the page, the open drawer) records nothing
on the ledger, because Undo means "take back my last answer", never "go back a page". Today
that is a `patch()` that simply never calls `record()`, and `inspect` reports it at version 0
forever. Chat records its session writes, so undoing there can re-join a room. The two examples
disagree and the kernel has no word for the choice.

**How.** Nothing to build; a sentence in `concepts/concept.ts` and the skill: a document whose
`patch()` does not record is off the ledger by design, its version is always 0, and undo never
lands on it. If the kernel ever grows a flag, `Concept.ledger?: false` is the shape.

## 6. The picture route is an example's, and should stay one

**What.** No change. Recorded so nobody adds one.

**Why.** The wedding stores uploaded bytes in its own `pictures` table and serves them from its
own `/pictures/*` route; the key that lands on a row is a plain document write, undoable like
any other. That used `Example.routes` exactly as intended and needed nothing generic. A kernel
"assets" seam would be a solution to a problem one example has once.

## Order

1 first: it removes code from both examples and settles a question every future example has.
2 next: it is the thing a person editing the wedding's lists feels. 4 is a morning's tidy. 3 is
worth doing only if a third example wants links. 5 is a paragraph.

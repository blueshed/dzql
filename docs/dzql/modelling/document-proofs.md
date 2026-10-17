# Proving that documents are complete

*25 September 2026.*

An app is made of **documents**: what a person sees in order to do a job. A document is
complete when two things are true:

1. **Every action a person needs can be taken.** There is a control for it, the person can
   reach it, and they are allowed to use it.
2. **Its effect is seen.** Everyone who should see the change sees it, what they see is what
   was stored, and nobody else sees it.

Over the last year each project in this line wrote checks for some part of that. This note
gathers all of them into one set of rules. Nothing here is new: every rule was needed by at
least one project, and each is shown with what went wrong without it.

## Words used

- **Actor** -- a kind of person using the app: a household, the couple, a supplier.
- **Story** -- one thing an actor wants to do, in a sentence that could be true or false:
  *"The Okafors say maybe, and the couple's board changes."*
- **Model** -- a description of the app written before any code: its data, its actors, its
  documents, and the writes each actor can make.
- **Write** -- one change a person makes: a document, a path in it, a value.
- **Echo** -- the change coming back from the server after a write. Pages are drawn from the
  echo, never from the click.
- **Turn** -- a change that someone else must now answer: an invitation, an offer, a request.
- **False green** -- a check that passed while the app was wrong.

## The laws

*Added 14 October 2026.*

The checks below enforce a smaller set of laws. Each law was carried from one project in this
line to the next (`history/documents-history.md`, the *What it preserved* sections). Each is
listed with where it came from and the checks that hold it to account.

### What a document is

**1. A document is what someone sees in order to do a job.**
Not a view of a table. Design starts there, not at the tables underneath. *(seiro, hjeli)*
Checked by [M2, M3](#m-the-model).

**2. The tables are the truth; a document is a lens over them.**
It is composed from the tables when it is read, never a second copy that can drift. *(delta,
epsilon: the blob tier was retired because no app ever hosted one.)*
Checked by [R1](#r-the-running-app).

**3. A document's name is data.**
`venue:42`, `mine:<uid>`. A per-person document is a per-person name, not a per-viewer special
case. *(delta, epsilon, pears)*
No check: a convention.

**4. Everything shown is a document, and there is one way in.**
Reading a document is also the permission check, so a document nobody may read is one nobody
can open. *(epsilon's `doc_open`, zeta's screen)*
Checked by [W1](#w-the-wire).

### How a change travels

**5. A write is one of three verbs on one path.**
Add, replace or remove, at a JSON Pointer path. Never a fourth; a gesture is one verb on one
path. *(railroad, delta, apples)*
Checked by [W2](#w-the-wire).

**6. The page is drawn from the echo, never from the click.**
Nothing is applied ahead of the server's answer: the round trip is designed, not hidden.
*(delta)*
Checked by [W4](#w-the-wire).

**7. A write is saved whole, with its history and its inverse.**
Undo is the inverse recorded at the moment of writing, not a feature added later. *(eta)*
Checked by [W3](#w-the-wire).

**8. Every change reaches every document that shows it, and no other.**
Including lists and totals that show the same rows another way. A page is never sent what it
does not show. *(dzql's question, answered by epsilon)*
Checked by [W5, W6](#w-the-wire) and [R1, R3](#r-the-running-app).

**9. What can be drawn is never sent.**
Only the inputs cross the wire. *(Broadcast XML, eta)*
Checked by [R3](#r-the-running-app), where a story fails if the wire carries more than the page
needs, and [W9](#w-the-wire).

### Whose truth, and who may change it

**10. Documents are sorted by where their truth lives.**
*Written*: a person's, undoable. *Fact*: recorded and never undone, kept out of the tables a
person's undo walks. *Live*: who is online, gone on restart. *Sourced*: from outside, carrying
when it was read. *Static*: shipped with a release. *(eta on delta)*
Checked by [W10](#w-the-wire), for sourced documents only.

**11. Undo takes back only your own change.**
It refuses rather than overwrite someone else's. Who made a change and the cursor undo walks are
two things. *(delta 0.7.0)*
Checked by [W8](#w-the-wire) and [R5](#r-the-running-app).

**12. Each field has one writer.**
A statement is owned and published by one party. A commitment is a claim by one party and an
acknowledgement by the other, each writing only its own part. *(Allertons, Broadcast XML)*
Checked by [M6, M10](#m-the-model); M10 is proposed and not built.

### Completeness

**13. Stories come first, and every story could be false.**
A story is something a person wants. One that only says "the drawer opens" cannot fail and
proves nothing. *(easy, hjeli, eta)*
Checked by [R4, R7](#r-the-running-app).

**14. Every write closes back on the people it involves.**
The writer sees the echo. Whoever is handed a turn can see it and answer it every way. A
control is shown if and only if the server will accept it. A refusal says why, beside the
control that sent it. *(hjeli, rights-market, apples, zeta)*
Checked by [M4, M5, M7, M8, M9](#m-the-model), [P1-P6](#p-the-page), [W7](#w-the-wire) and
[R2](#r-the-running-app).

**15. The proof runs on what was built, not only on the model.**
Generating and running the app is the test; the audit alone is not. *(hjeli, the Can You?
builds)*
Checked by [R6](#r-the-running-app) and [H1, H3](#h-a-person-looks).

**16. A check aimed at the wrong thing is a false green.**
Coverage measures nothing when the assertion looks in the wrong place: a false wedding story
passed at 100% while the stories checked the tables, not what each person was sent. *(eta)*
Checked by [R2, R3](#r-the-running-app): check what each person is sent, and check everyone.

## Five places a check can run

| | Where | When | Example |
|---|---|---|---|
| **M** | The model | Before any code | "Every write reaches a document the writer watches." |
| **P** | The page | When deciding the pages | "Every story has a button on a page its actor can reach." |
| **W** | The wire | On every message, at runtime | "A write the model didn't declare is refused." |
| **R** | The running app | In tests, by driving the app | "After every change, each open page equals a fresh one." |
| **H** | A person | By looking | "Render the page and read it as its reader would." |

The earlier the place, the cheaper the fix; but only the later places see what really
happens. A model can pass every check and still refuse the story once it is built (rule R6).

---

## M. The model

These run on the model, before code exists. hjeli runs the first six today.

**M1. Every name points at something real.**
Every table, field, value, document, actor and write named in the model exists.
*Without it:* a rule compared a date with the text "NULL" instead of checking it was empty, and
the model still passed.

**M2. Every piece of data is shown somewhere.**
No table exists that no document shows.

**M3. Every actor can exist, and has something to look at.**
Some write makes a person into this actor, and the actor has at least one document to watch.
An actor who can only write, and never read, is working blind.

**M4. Every state the app needs can be reached.**
Anything a write depends on -- a row existing, a status being "accepted" -- is produced by some
other write. A status nobody can set is a dead end.
*Without it:* a sample model passed while "accepted" and "rejected" were statuses no write
could set.

**M5. Every write is allowed for the person making it, on the row they touch.**
Checking "suppliers may edit offers" is not enough; it must be "this supplier may edit this
offer". The rule the model turns into in the database must allow the row the write actually
makes.
*Without it:* a model passed while the person who created a task could neither ask anyone to
help nor see the answers.

**M6. A move meant for someone else is made by someone else.**
If a write waits on another party (accepting an offer), the model gives that write to the other
party, and the app checks it on the actual row.

**M7. Every write reaches a document the writer is watching.**
Not "some document somewhere": one the writer has open, and one that includes the row written.
Otherwise the writer acts and sees nothing happen.

**M8. When a write hands someone a turn, they can see it.**
The person who must answer has a document that shows the thing waiting for them. That document
must not only show it after they answer.
*Without it:* a marketplace passed every model check while sponsors could not see the
campaigns offered to them and suppliers could not see the orders open to them.

**M9. Every turn can be answered every way.**
An offer can be accepted, declined and withdrawn. (A public listing is the exception: ignoring
it is the decline.)
*Without it:* the same marketplace had no way to decline, withdraw or buy.

**M10. Each field has one writer.**
When two parties share a document, each writes only their own fields, so neither can overwrite
the other. *Proposed; not built anywhere.*

## P. The page

These run when the pages are decided, before or beside the code.

**P1. Every story has a control on a page its actor can reach.**
For each story, name the page and the button or field that does it.
*Without it:* three wedding stories passed their tests with no button for them on any page.

**P2. Every control's echo appears on a page its actor has open.**
Find this by running each story, not by reading a table.
*Without it:* a page table was read many times and was still wrong in one cell; only running
the story found it.

**P3. A control is shown if and only if the action is allowed.**
Both ways: every write the server accepts has a story and a control, and every control on the
page is one the server will accept. No hidden writes, no buttons that always fail.
*Without it:* the server accepted deleting a task that no story or button could delete; a
typo in a button's path passed every check and failed only when clicked.

**P4. Every field a person may change has a place to change it.**
And a required field is refused before the save, not after.

**P5. Nothing is created or kept where it cannot be seen.**
A filter dims what it hides and says how many; saving something a filter would hide clears the
filter; an unknown number is shown as unknown, never counted as zero.

**P6. Whose move it is shows on the thing itself.**
An offer says who is waiting on whom. The other side's step is shown, never taken from here.

## W. The wire

These are enforced by the server, on every message.

**W1. There is one way to read, and it checks permission every time.**
A person is sent only the documents they may read, and only while they may read them.
*Without it:* one app sent each user's private list to every user with a list open.

**W2. Only declared writes are accepted.**
A write to a path, field or document the app never declared is refused, and nothing is kept.

**W3. A write lands whole, in the document it names.**
The change and its record in the history are saved together or not at all. A change that
touches several documents is saved as one.

**W4. The screen shows what was stored.**
Nothing is drawn from the click; the echo carries what the database actually saved.

**W5. Every change reaches every document that shows it.**
Including documents that show the same rows another way, lists and totals, deletions that
remove other rows too, and other server processes.
*Without it:* a trip's page was at version 55 while its entry in the trip list was still at
version 1.

**W6. Nothing is missed, and a lost document is taken away visibly.**
Changes arrive in order; a gap is noticed and repaired. When a person loses access to a
document, their page says so instead of freezing.

**W7. A refused write says why, next to the control that sent it.**
Nothing else changes, and what the person typed is kept.
*Without it:* until 25 September, eta returned the page unchanged and said nothing.

**W8. Undo takes back only your own changes, and never someone else's.**
If someone has since changed the same thing, undo refuses and says so. An undo that can't be
done is skipped by name, so the next one still works.
*Without it:* in delta 0.6.0, Ada sets the topic to "tea", Ben changes it to "coffee", Ada
presses undo, and Ben's change is gone.

**W9. No password or session id is ever sent to a page.**

**W10. Old data says it is old.**
A reading from outside (a thermometer, a price) shows when it was taken, and says so when it is
stale.

## R. The running app

These are proved by driving the real app in tests.

**R1. Every open page equals a fresh page, after every change.**
After each change, undo and redo, what each person has on screen equals what a fresh read from
the database would give them. Check every document that shows the change, not only the one
written.
*Without it:* three price-board bugs passed every test until this check was added.

**R2. Every story is done the way a person would do it.**
Find the control on the author's page and use it. Then check the database changed, by that
person. A closed dialog is not proof.
*Without it:* "the dialog closes, everything looks fine, nothing happened."

**R3. Every story says who sees the change, and everyone else is checked not to.**
Nobody in the test is left unchecked.
*Without it:* "Bo, not watching Alpha, notices nothing" was never checked, and fails when it
is.

**R4. A story that does something must change something, and a story that can't must be
refused.**
*Without it:* a refused write passed as a story; a harmless write passed as a refusal.

**R5. Undo is tested with someone else changing things in between.**
*Without it:* tests only ever undo straight away, so undo overwriting someone's change is never
seen.

**R6. Test the code the model produces, not just the model.**
*Without it:* twice, a model passed every check while the database rule it produced refused
the story.

**R7. A story is something a person wants, and it could be false.**
A story that only describes the page moving ("the drawer opens") cannot fail and proves
nothing.

## H. A person looks

**H1. Look at every page as its reader would.**
A control nobody can see does not exist.
*Without it:* a Leave button sat below the fold, and no test noticed.

**H2. Count the clicks and keys for every action, with a year's worth of data.**
Pointer and keyboard both.

**H3. Build the app from the written description alone.**
Every sentence that was unclear, missing or wrong is a finding.

---

## Where eta and delta stand (25 September 2026, eta 0.49.0, delta 0.8.0)

| Rule | Status |
|---|---|
| **M1-M10** the model | eta has no model beside its stories. hjeli checks M1-M7 for its own models, M7 more loosely than stated here. M8-M9 run only in rights-market's scripts. M10 is not built anywhere. |
| **P1** a control for every story | Done: before a story's write is sent, the harness finds its control on the author's page, from where the story says they act. It found five wedding stories nobody could do. |
| **P2** the echo appears for the actor | Partly: stories check the author's page changed |
| **P3** shown only if allowed | Half: a button offered that is always refused fails its story. A write the server accepts that no page offers is not found. |
| **P4-P6** | Partly, through the page rules in each example |
| **W1** one way to read | Done |
| **W2** only declared writes | Done (Postgres skips one check) |
| **W3** a write lands whole | For one document; a change across documents is not one save |
| **W4** show what was stored | Done |
| **W5** every document that shows it | On SQLite, in one process; Postgres doesn't pass changes between documents |
| **W6** nothing missed | For versioned documents only |
| **W7** a refusal says why | Done: a compartment refuses with a reason, shown beside the control; a plain refusal stays silent |
| **W8** undo never overwrites | Done: delta 0.7.0 walks nothing on a conflict, and eta says so |
| **W9** no session id sent | Done |
| **W10** old data says so | For outside readings only |
| **R1** open page equals fresh page | Done for pages and applets; the "fresh" page reads the server's copy, not the database |
| **R2** done as a person would | Partly: the control is found on the page and the write must land; the harness still sends it, rather than clicking |
| **R3** everyone checked | Done: everyone in the cast is checked, named or not. It found the ticker's board told of every tick. |
| **R4** does changes, cannot refuses | Done for `does`: nothing landed fails. A `cannot` passes on anything that applies nothing; eta treats a no-op as a refusal. |
| **R5** undo with someone in between | Partly: in the wedding's server tests, not yet in the stories |
| **R6** test the produced code | Holds: eta's stories run the real app |
| **R7** stories that could be false | Done |

**Suggested order now:** R2 whole (drive the control, not the wire), which makes P2 exact.
Then R5 in the stories (a story that can say "meanwhile"). Then W5 on Postgres, in delta. Then
R1 from the database. Then the other half of P3, and a model beside the stories for M1-M10 --
the eta modeller.

## Where each rule came from

- **M1-M7**: hjeli's six predicates (`blueshed/hjeli/src/core/predicates.ts`), with M3, M5 and
  M7 as hjeli's own docs state them rather than as its code checks them.
- **M8-M9**: turn closure, in `medwyn/apps/rights/derive-ux.ts`; proposed as hjeli's seventh
  check.
- **M10**: writer closure, `docs/history/documents-history.md` open question 5.
- **P1-P4**: apples' page rules (`apples_pears/apples.md`, *The page*), easy's story links,
  zeta's findings, eta's review of 17 September.
- **P5-P6, H2**: `concept/constitution.md`, articles 1-5, 15 and 16.
- **W1-W6**: dzql, simple, epsilon (`blueshed/epsilon/db/003-doc-kit.sql`), pears, delta.
- **W7**: zeta, decisions 8 and 18.
- **W8**: epsilon's undo; see `docs/history/zeta-lost-out.md`.
- **R1**: epsilon's `proveLaw` (`blueshed/epsilon/epsilon/law.ts`) and eta's story harness
  (`eta/src/harness.ts`).
- **R2**: the rights-market walkthroughs and grand tours.
- **R3-R5**: gaps found in eta's harness this week.
- **R6**: hjeli, and the Can You? builds in `apples_pears/examples`.
- **H1, H3**: apples & pears' method.

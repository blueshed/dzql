# The Shed: what each stage is checked against

For the checker, never for the session making the app (`stories.md` says how a stage is run). Each
stage is held to three things:

- **Behaviour.** Every story of the stage, and of the stages before, is true. Check each over the
  wire with a delta client in the test process (who is sent what, and who is sent nothing), and by
  hand in the page.
- **Structure.** What the stories should have forced, in the shapes the skills teach.
- **What it must not do.** Each item is a way to make a story pass for the wrong reason.

Every stage also: `bun test` passes at 100% coverage, `bun run typecheck` is clean, the CHANGELOG
says what landed, and `todo.jsonl` holds what was left open.

The shapes below name what the stories force, not file or document names: any names that say the
same thing pass.

## Stage 1: one shared document

**Structure.**
- The shed's list is one shared document from the start (`registerDoc`, opened with `openDoc`).
- A resource folder follows the template's layout (`-api.ts`, the document side, `-view.tsx`).
- Tools are rows addressed by id, never by position.
- A change that is not a tool with a name is refused by the document's rule, a 400 with a message
  the page shows.
- Tests cover a refused change and what a person sees and clicks.

**Must not.**
- No HTTP routes for the list; no polling.
- The page never sets the list itself: it sends the change and draws what comes back.

## Stage 2: two documents on one page

**Structure.**
- The borrowing page holds two documents: the shed's list, and the member's own basket or loan, a
  document per member. Its name carries who the member is.
- A basket line refers to a tool by its id, and the page draws the tool's name from the list. So a
  rename shows in the basket (story 3) without the basket changing.
- Borrowing makes the loan, dated, and empties the basket. It is kept on the server, so it is
  there on another phone (story 5).
- Who the member is can be as simple as the app chooses (a name picked, or in the URL). It must
  keep Ann's basket from being Ben's.

**Must not.**
- No copy of a tool's name kept in the basket.
- No basket in the browser's own storage.
- No one document holding every member's basket for each page to filter.

## Stage 3: rows shared between documents, and undo

**Structure.**
- The documents move to delta's SQLite store. The list, each member's loan and Sam's board are
  documents over the same rows: tools, loans and their lines, members. The tables follow from the
  documents.
- Sam's board is one document over every loan.
- "Out" comes from the open loans themselves, shown on every list, and changes when a loan is made
  or returned (story 2).
- Borrowing a tool that is out is refused by the write, with a message (story 3). The refusal
  holds when two members try at once.
- Undo is delta's ledger, walked by the member's own cursor: undo for each person (stories 4 and
  5).
- The board holds only some of a member's columns: their name, not their phone (story 6). Either
  the document names the columns it holds (`columns`), or the phone is kept apart.

**Must not.**
- No "out" flag set by hand beside the loans, which can drift from them.
- No undo of its own making: no stack in the page, no table of past values.
- No phone number sent to Sam's board and hidden in the page.

## Stage 4: a change on a database that holds data

**Structure.**
- The schema declares the due date and the kit's parts. The parts are rows under their tool, a
  parent chain from tool to part, lent with the tool.
- What a schema cannot say is a migration:
  - the due date filled in for loans made before, from each loan's own day (story 3);
  - the strimmer's battery and charger made its parts.
- Each migration is a file of its own, run once and never edited after.
- A test starts from a database holding loans made before the change, runs the migrations, and
  finds every loan there, with what is out still out (story 4).

**Must not.**
- The change is not made by dropping and recreating tables, or by resetting the data.
- No due date computed in the page in place of being stored.
- A kit is not three loose tools that happen to be borrowed together.

## Stage 5: two servers, and each member's own

**Structure.**
- The documents move to dzql, delta's compiled Postgres step, on a Postgres server: the same
  schema and documents, with dzql's imports.
  - Two server processes, the north shed's and the south gate's, share one database. A change
    through either reaches every page open on either (story 1).
  - The generated SQL is the compiler's: `dzql sql` run again on the app's definitions gives
    exactly the file the app applies, with no hand edits.
- Each member's view of loans is a document whose `owns` says who may open it:
  - their own loans, by the loan's member (story 2);
  - their field's loans, by a path through membership, from the field to its members (story 3);
  - every loan, for the committee (story 4).
- A name nobody may open answers as one that is not there.
- A non-member opens the list and nothing else (story 5).
- Members' phone numbers are in a document only the committee may open (story 4).
- `owns` as a path is dzql's step 3 (`docs/postgres-split-plan.md`). Until it ships, `owns` as a
  function passes. Say which was used in the run's results.
- Every earlier story still passes against the Postgres server (story 6), with the tests from
  stages 1 to 4 run on it.

**Must not.**
- No filtering of loans in the page or in a route.
- No document that sends every loan to everyone for the page to narrow.
- No hand-written SQL in place of what the compiler writes, beyond migrations.

## Recording a run

A run is one model taking all five stages. Record it in `runs/<date>-<model>.md`, with one line
per stage: each check passed or failed, the files the session wrote, and what it did that the
skills did not lead it to. Where it went wrong, say whether a skill, a reference or a library
should change, and ledger that in `todo.jsonl`. Start with one model; run Haiku, Sonnet and Opus
once the stories and checks have settled.

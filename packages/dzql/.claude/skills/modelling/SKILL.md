---
name: modelling
description: Use only while someone is telling you the stories of an app to be built, there to answer -- to write each story down on the model's page as it is told, describe the documents it needs (root, what each holds, who holds it), and read the gaps back, before any of the app is built. Then `dzql model` makes the app's types, guards, migrations and stories from it for any store (a JSON file, SQLite, Postgres), and the app is built from them with dzql-app. reference.md has the verbs, the gaps and the move to an app, with a contents table.
metadata:
  version: 0.53.0
---

# Keeping the model while the stories are told

One person tells the stories; you write them down on the model's page and describe the documents
they need, while they watch each change land. The model is a delta document, so every change
undoes. The entities are worked out from the documents, never written: if they look wrong, a
document is. `reference.md` has each part, with a contents table.

Asked to build or change the app instead, this is not the skill: load **dzql-app** and build it.
With nobody there to answer, never stop to wait: note the question, take the most natural reading,
and go on. A server is a way of waiting too: the page never exits, and a session that leaves it
running never ends. Start it in the background, keep each change one at a time all the same, stop
it (`bun run stop`) before your last message, and never start it again; where a teller would be
handed a link, say what to run to open the page (`bun dev`, or `bun run model`).

## The order

1. **Start the page, give the teller their link, and sign the CLI in with yours.** `dzql model` (or
   `bun dev`, the model's page beside the app) prints a sign-in link for each keeper as it starts: hand the teller theirs at once
   (Peter's, the first of `MODEL_PEOPLE`), with no homework, and sign the CLI in with Claude's
   (`login <link>`). Never sign the two in as one person. → reference: *Where it runs*
   - **One change at a time, while the teller watches.** Say it, write it, let them see it land on
     the page; never a wall of commands. Stories and documents go by their number (`show` lists
     them), entities by their plural (`invoices`). A bare `refused` is a session signed out: sign
     in again and say so, never work around it.
2. **Write the story down as it was said**: who tells it, whether they do it or are refused, their
   words. Don't improve it; ask, and reword what they say. Where their word is not the entity's
   (they say "bill", the entity is `invoices`), keep their word in the story, and say the entity's
   name once, in a line ("a bill is an invoice here"). → *The verbs*
3. **Ask what the person needs in front of them to do it.** That is a document; whoever else must
   see the change holds it too. Name it for what it is to them, not for a table, in one word
   (`seat`, `invoice`). → *Documents*
   - **A read is the "who sees it" half of a write story, never a story of its own.** When someone
     needs to see something, find the writes that change it: their holders go in those stories, and
     the document serves them.
4. **Say what it holds and what the story writes**, with only the fields a story needs: `writes`
   (add, replace a field to a value, remove) and `requires` (the state it presupposes), as hjeli
   had them; `touches` where the teller has not said more. Work backward from the write: who must
   see it land, and in which document. A rule that spans rows ("no other unpaid invoice on this
   table") needs a field on the row it is about that says the state (`tables.seated`), set by the
   stories. → *The verbs*
5. **Read the checks after every change** -- hjeli's six, Easy's coverage, playability (across the
   top of the page; `show` prints them; `dzql model check` exits 1 while one is open). Then lead: propose the next change that
   closes a gap, and let the teller accept, reword or refuse it. A red register is closed by adding
   what is missing, never by taking out what it found. **Decide the obvious; ask what could go
   either way; never ask twice** (Peter, 18 October): a gap with one sensible answer (may a customer
   change the menu? no) you close yourself, saying in one line what you decided; one that could go
   either way is a question for the teller. Before asking, check what they already said: "orders
   from a menu" already says an ordered item is a menu item. → *The gaps*
6. **Build nothing yet.** The model is done enough when the checks are closed (or say why they
   cannot be asked) and the teller reads the page and calls each story true. While none is open,
   `dzql model` (or `bun dev`, the model at `/model` beside the app) writes
   `model/types.ts`, `guards.ts`, `migrations/` and `model.test.ts`, never a story. Then run the
   model's proof, `bun test model`: closed checks are not proof. A failing case is a gap: tell the
   teller, and change the model until it passes. The app is
   built from them with the **dzql-app** skill, as dzql's `examples/cafe/` was (its README walks
   it). → *From the model to the app*

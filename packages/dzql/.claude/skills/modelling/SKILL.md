---
name: modelling
description: Use only while someone is telling you the stories of an app to be built, there to answer -- to write each story down on the model's page as it is told, describe the documents it needs (root, what each holds, who holds it), and read the gaps back, before any of the app is built. Then `dzql model` makes the app's types, guards, migrations and stories from it for any store (a JSON file, SQLite, Postgres), and the app is built from them with eta-app. reference.md has the verbs, the gaps and the move to an app, with a contents table.
metadata:
  version: 0.53.0
---

# Keeping the model while the stories are told

One person tells the stories; you write them down on the model's page and describe the documents
they need, while they watch each change land. The model is a delta document, so every change
undoes. The entities are worked out from the documents, never written: if they look wrong, a
document is. `reference.md` has each part, with a contents table.

Asked to build or change the app instead, this is not the skill: load **eta-app** and build it.
With nobody there to answer, never stop to wait: note the question, take the most natural reading,
and go on.

## The order

1. **Start the page and sign the CLI in.** → reference: *Where it runs*
2. **Write the story down as it was said**: who tells it, whether they do it or are refused, their
   words. Don't improve it; ask, and reword what they say. → *The verbs*
3. **Ask what the person needs in front of them to do it.** That is a document; whoever else must
   see the change holds it too. Name it for what it is to them, not for a table. → *Documents*
4. **Say what it holds and what the story writes**, with only the fields a story needs: `writes`
   (add, replace a field to a value, remove) and `requires` (the state it presupposes), as hjeli
   had them; `touches` where the teller has not said more. Work backward from the write: who must
   see it land, and in which document. → *The verbs*
5. **Read the checks after every change** -- hjeli's six, Easy's coverage, playability (across the
   top of the page; `show` prints them; `dzql model check` exits 1 while one is open). Then lead: propose the next change that
   closes a gap, and let the teller accept, reword or refuse it. A red register is closed by adding
   what is missing, never by taking out what it found. Each gap is a question for the teller, never
   something to fix quietly. → *The gaps*
6. **Build nothing yet.** The model is done enough when the checks are closed (or say why they
   cannot be asked) and the teller reads the page and calls each story true. While none is open,
   `dzql model` (or `dzql serve`, the model at `/model` beside the app) writes the app's
   `types.ts`, `guards.ts`, migrations and stories; the app is built from them with the **eta-app**
   skill -- load it, and its page and bento references, before drawing a page. → *From the model to the app*

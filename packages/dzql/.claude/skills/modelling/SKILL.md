---
name: modelling
description: Use only while someone is telling you the stories of an app to be built, there to answer -- to write each story down on the model's page as it is told, describe the documents it needs (root, what each holds, who holds it), and read the gaps back, before any of the app is built. Then `dzql model export` writes its schema and documents for any store (a JSON file, SQLite, Postgres), and the app is built from the model. reference.md has the verbs, the gaps and the move to an app, with a contents table.
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
4. **Say what it holds and what the story touches**, with only the fields a story needs.
5. **Read the page back** (`show` prints it). Each gap is a question for the teller, never something to fix quietly.
   → *The gaps*
6. **Build nothing yet.** The model is done enough when the teller reads the page and calls each
   story true. Then `dzql model export --out model.ts` writes its schema and documents as delta's
   definitions, which every store takes, and the app is built from them: the **eta-app** skill for
   a page the server draws. → *From the model to the app*

# Saying why: refusals, successes, and Undo checked

A write refused says why beside the control that sent it; a write, an undo or a redo may say what
it did. The rules are a resource's ([resource.md](resource.md)).

```ts
// examples/leave/documents.ts: a rule in shape, in the story's words
if (ends < starts) throw refuse("The last day is before the first.");

// examples/leave/page.ts: the line drawn beside the field that sent it
`<input type="date" name="${which}"${write(doc, "replace", `${base}/${which}`)} value="${esc(s[which] ?? "")}"></label>${toldAt(sessionId, doc, `${base}/${which}`)}`

// examples/wedding/resources/household.ts: a rule of time that holds against Undo too,
// and what a walk did, said over the page
permitUndo(_ws, _id, ops) {
  if (weddingDoc.answersOpen()) return true;
  if (ops.some((op) => op.op === "replace" && DATED.has(op.path.split("/").at(-1)!))) throw refuse("Answers closed at the deadline.");
  return true;
},
async afterWalk(ws, id, { way, ops, inverse }) {
  const [left, was] = way === "undo" ? [inverse, ops] : [ops, inverse];
  const words = await settled(activeDocuments(), () => householdDoc.whatItDid(left, was, householdDoc.read(id)!, weddingDoc.gifts()));
  if (words.length > 0) await tell(ws.data.sessionId, { doc: "ledger", path: "/latest", said: `${way === "undo" ? "Undone" : "Redone"}: ${words.join(", ")}.` });
},
```

`refuse`, `tell` and `toldAt` are `src/rendering/refusal.ts`.

- Throw `refuse(reason)` from `permit` or `shape`. A plain `false` refuses without a word: right for
  a write no control offers, where there is nowhere to say why.
- `toldAt(sessionId, doc, path)`, where `doc` and `path` are the control's `data-write`, draws
  `<p class="refused" role="alert">`, `<p class="said" role="status">` for a success, or nothing.
- A success is told, not thrown: `tell(sessionId, { doc, path, said })`, from `afterWrite`,
  `afterWalk` or a route that answered a form. A line is `reason` or `said`, never both.
- Never keep "what just happened" in a field of your own session: the harness compares an author's
  pages without what `tell` told them.
- The line lives in the session's `told` document (in memory, off the ledger) until the session's
  next write. The page that sent the write is also answered `refused`, by its id ([wire.md](wire.md)).
- Where the browser can refuse first (`required`, `pattern`), let it.

## Undo is checked before it runs

- The kernel asks delta what an undo or redo would write, in the wire's paths (each field it sets
  back its own `replace`), and asks `permitUndo(ws, docId, ops)`. Omitted: always.
- It is not `permit`: Undo may do what permit refuses (a message taken back). It is for a rule of
  time or state that holds against Undo too.
- An undo that meets someone else's later write changes nothing, and says so: "Someone has changed
  that since, so it cannot be undone."
- Why an undo or redo was refused, and what `afterWalk` tells on `{ doc: "ledger", path: "/latest" }`,
  are drawn over the page (`.undo-said`), where Undo is.

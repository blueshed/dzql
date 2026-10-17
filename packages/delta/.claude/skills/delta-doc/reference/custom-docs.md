# Custom documents: derived, read-only views

From `examples/sites-bbox/server.ts`: the sites inside a box, kept live as sites move.

```ts
const sitesInBbox = defineCustomDoc<BBox>("sites-in-bbox:", {
  watch: ["sites"],
  parse,                                    // "0,0,50,50" → { minLng, minLat, maxLng, maxLat }
  query: (db, c) => ({
    sites: db.query("SELECT * FROM sites WHERE lng BETWEEN ? AND ? AND lat BETWEEN ? AND ?")
      .all(c.minLng, c.maxLng, c.minLat, c.maxLat),
  }),
  matches,                                  // (collection, row, criteria) → still in the box?
});
registerDocs(ws, db, schema, [worldDoc], [sitesInBbox]);
```

`CustomDoc` in `src/server/custom.ts` is the contract. Clients open it like any document; writes
go through the documents over the watched collections. Pick by shape, and never mix the two:

- **Membership** (`query` + `matches`): a flat view, `{ [collection]: { [id]: row } }`. `query`
  loads; `matches` decides per changed row whether it belongs. Told as single ops.
- **Recompute** (`recompute`): any shape, nested, joined, aggregated or per person. Read again
  whole on every write to a watched collection and sent as a root replace (`replace ""`).
  Return `null` for not found (404 on open; on a write, subscribers are let go with 404).

## A fact from another parent's rows

From `tests/derived-fact.test.ts`: whether each tool is out, and when it is due, from the open loans,
which hang from members. A row has one parent, so the tools' list cannot include the loans; the
board reads both, again on every write to either, and nothing stores `out`.

```ts
const board = defineCustomDoc("board:", {
  watch: ["tools", "loans"],
  parse: (id: string) => id,
  recompute: (db: Database) => ({
    tools: Object.fromEntries((db.query(`
      SELECT t.id, t.name, l.id IS NOT NULL AS out, l.due
        FROM tools t LEFT JOIN loans l ON l.tool = t.id AND l.returned IS NULL
       ORDER BY t.id`).all() as any[]).map((t) => [t.id, { ...t, out: !!t.out }])),
  }),
});
registerDocs(ws, db, schema, [shed, member], [board]);   // borrow through member:, the board follows
```

Pages that change the tools or borrow write through `shed:` and `member:`; the board is read-only.
`unique: [{ columns: ["tool"], whereNull: ["returned"] }]` on the loans keeps a tool on one open loan.

## Gotchas

- **The callbacks take a synchronous `bun:sqlite` handle**, on SQLite and the JSON file alike
  (on Postgres, dzql's take a `Pool` and are awaited).
- **With `auth`, say who owns it**: `owns` or `shared: true`; with neither, registration
  throws, and with either but no `auth` it throws too (`ownership.md`).
- **The name is untrusted.** `parse` reads whatever the client asked for. Check it with `owns`,
  and check the parsed id against the identity (return null).
- `query`, `matches` and `recompute` are given the identity. Nothing filters what they read or
  the row `matches` is shown: check every row against the identity.
- `identity` is `undefined` without sign-in: guard it. A recompute that throws is logged and
  that subscriber's update is dropped.
- Membership results are cached per name and identity. Recompute is **not** cached and has no
  relevance gate: cost is identities subscribed × writes to any watched collection. Keep
  `watch` tight and `recompute` cheap.
- A recompute view is sent to each subscriber alone, with no `v`; in-process, `onPublish` hears
  it with `to` naming the identity (`local.md`).
- A name goes to the longest prefix it starts with, a table document's or a custom one's.

## Root replace

`applyOps(doc, [{ op: "replace", path: "", value: next }])` swaps the whole document **in place**
(same kind, object or array, else it throws); `remove ""` clears it. Both sides hold the value by
reference, so in place is what keeps `doc.data` live.


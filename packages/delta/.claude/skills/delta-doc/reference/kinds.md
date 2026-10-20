# Documents not kept in tables: memory, source, static

From `tests/kinds.test.ts`: who is here, live, written by the server.

```ts
const here = registerMemory(ws, { prefix: "here:", empty: () => ({ people: {} }) });
// a page opens "here:general" → { people: {}, _v: 0 }
here.write("here:general", [{ op: "add", path: "/people/p1", value: "Ada" }]);   // → { result: { ack, version: 1, ops } }
// told { doc: "here:general", ops: [...], v: 1 }
here.peek("here:general");                            // { people: { p1: "Ada" } }; forget(name) empties it
```

Options and handles: `MemoryOptions`, `SourceOptions`, `StaticOptions`, `Sourced` in
`src/server/kinds.ts` (`@blueshed/delta/kinds`). Each registers a prefix on any `WsServer` and the
browser opens it like any document. A document kept in a file is the JSON file's, with a schema
(`backends.md`): settings, a scratchpad, one row of a table.

Working: [examples/lobby](https://github.com/blueshed/dzql/blob/main/packages/delta/examples/lobby/README.md), all three on one page: who is
here (memory) and the colours to wear (static) in `resources/here/here-api.ts`, the server's load
(source) in `resources/load/load-api.ts`.

## Memory: the truth is this process

Who is online, cursors, a lobby. Gone on restart, never on a ledger.

- **Written by the server**: `write(name, ops)`, from the handle `registerMemory` returns, on
  `createWs()` or `createLocal()` alike (a `createLocal()` caller's `delta` writes it too). Over
  a socket a `delta` is 403 unless `writable: "any"`. Who is here: a method (`registerMethod`)
  writes the person in, `onClientDrop(client, ...)` out again when their socket goes
  (`examples/lobby/resources/here/here-api.ts`).
- An op that does not land changes nothing: 404 for what is not there, 400 malformed (and a
  name not of the prefix, to `write`). `write` answers as a `delta` does, never throws.
- `add /<coll>/-` on a map of rows names the row with a uuid (path and `id`); on an array, appends.
- Open answers `{ ...value, _v }`; a write `{ ack, version, ops }`, broadcast with `v`.

## Source: the truth is outside

```ts
const reactor = registerSource(ws, { prefix: "reactor:", read: async (id) => readSensor(id),
  every: 5_000, stale: 30_000 });   // or subscribe: (id, push) => stop
// open "reactor:core" → { reading, at, stale, _v };  reactor.stopAll() on shutdown
```

- One reading shared by every watcher: read on the first open, polled or pushed while anyone
  watches, stopped when the last leaves.
- `stale` turns true when no reading comes within `stale` ms, so a page can say so. A failed
  read gives no reading (a first one opens `{ reading: null, at: null, stale: true }`).
- A reading equal to the last only moves `at`. Every write is 403.

## Static: the truth is the release

`registerStatic(ws, { prefix: "units:", value: (id) => UNITS[id] })`: undefined is 404. The
value must be an object; open answers it spread with `_v: 1`. Every write is 403.

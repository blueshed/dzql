# eta

A thin server-rendered chat app: the server owns all state as SQL-backed
documents, every change is a JSON Patch recorded in a ledger, and the
client's only job is to swap in the HTML it's sent (morphed, not replaced)
and forward `data-write` gestures back over a websocket.

## Running

This project uses Bun, not Node or npm.

```
bun install
bun run dev     # bun --watch src/start.ts, in the foreground
bun run start   # same, detached (writes server.pid, logs to server.log)
bun run stop    # kills the pid in server.pid
bun run test    # bun test --coverage
```

## Legibility

Two calls exist so a person can answer "what happened" without adding a
log line. From the wire, sending `{"type":"inspect"}` gets back this
connection's session, the documents it currently sees (session, and room
if it's in one) with each one's version and the latest ledger entry behind
it. From the browser console, `window.eta.inspect()` reports what the
client itself has seen: the docs it holds (`window.eta.docs()`) plus the
last write it sent and whether the server echoed it back.

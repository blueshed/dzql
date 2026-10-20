# lobby

Who is here now, and how busy the server is. Nothing in it is stored: each document is a kind
whose truth is somewhere other than a table.

| Document | Its truth | Kind |
|---|---|---|
| `here:lobby` | this process: who is connected, gone on restart | memory |
| `colours:` | the release: the colours a person may wear | static |
| `load:server` | the machine: its load, read while anyone watches | source |

Open the page and you hold all three. Join with a name and a colour, and everyone holding the
lobby sees you arrive; close the tab, and they see you go. The page never writes `here:lobby`
(over the socket a write is 403): it calls `join`, and the server, which knows who is connected,
writes them in, and out again when their socket goes.

It shows, working, what the delta-doc skill's [kinds.md](../../.claude/skills/delta-doc/reference/kinds.md) teaches.

## What is here

The app is its routes and its resources, as every app is (paintbrush's README, *Routes,
resources and documents*):

```
routes.ts              the app: the page and the socket, given to delta's serve; run, it is the server
index.html, index.css  the page
app.tsx                the socket every document rides (joining again on every connect), and the views
resources/here/
  here-api.ts          here:lobby (memory), colours: (static), and join
  here.ts              the handles, join, and rejoin on a connect
  here-view.tsx        who is here, each in their colour, and the line to join
resources/load/
  load-api.ts          load:server (source): one reading, every two seconds while watched
  load.ts              its handle
  load-view.tsx        one line: the reading, or that it is stale
```

## Run it

```sh
bun examples/lobby/routes.ts                    # port 3100
```

Open <http://localhost:3100> in two tabs. Join in one: the other sees you, in your colour. Close
it: you go from the other.

```ts
// here-api.ts: the lobby, written by the server as sockets join and go
const here = registerMemory<Here>(ws, { prefix: "here:", empty: () => ({ people: {} }) });
registerMethod(ws, "join", ({ name, colour }, client) => {
  here.write("here:lobby", [{ op: "add", path: joinPath("people", client.data.clientId), value: person }]);
  onClientDrop(client, leave);   // out again when the socket goes
  ...
});

// the colours, fixed for the release; the load, read from the machine while anyone watches
registerStatic<Colours>(ws, { prefix: "colours:", value: (id) => (id === "" ? { colours: COLOURS } : undefined) });
registerSource<number>(ws, { prefix: "load:", read: () => loadavg()[0], every: 2_000, stale: 10_000 });

// app.tsx: a socket that drops has left the lobby, so the page joins again on every connect
provide(WS, connectWs("/ws", { onConnect: rejoin }));
```

The pages open `here:lobby` on the socket, and the server writes it with the `write` its
registration gives: told to everyone holding it, as any write is.

## How it is tested

`tests/examples.test.ts` runs `routes.ts` as above:

- two browsers: one joins as Ann in seagreen, and the other shows her so; her page closes, and
  the other shows nobody;
- on the wire: a join is told to everyone holding the lobby, as an `add` of that person; a page's
  own write to it is 403; `colours:` opens with its colours and refuses a write (403); two
  watchers of `load:server` hold one reading, not stale; a socket that closes is told to the
  rest as a `remove`.

# Evolving a resource: references

## Contents

- [Add a resource](#add-a-resource): HTTP routes, a store, a view, and their tests (step 1)
- [Push changes over the WebSocket](#push-changes-over-the-websocket) (step 2)
- [Store in SQLite](#store-in-sqlite) (`bun:sqlite`)
- [Store in S3](#store-in-s3) (`Bun.s3`), with a stand-in bucket for tests
- [Make it a delta document](#make-it-a-delta-document) (step 3)
- [Beyond: eta](#beyond-eta) (step 4)
- [Build for production](#build-for-production) (optional)

Each section was run on Bun 1.4.3 with railroad 0.16.0; the delta section with delta 0.12.0, and the S3 section against the stand-in bucket (and against MinIO, on Bun 1.4.2).

## Add a resource

Rules for handlers:

- A handler is a plain function that returns a `Response`. Validate what a client sends, and answer 400 with `{ error }`.
- The client imports the type with `import type`, so no server code reaches the browser.
- A `Bun.file(path)` keeps the size it first saw (`exists()` and `size` look): after `Bun.write` changes the file, `exists()` says true but `.json()` reads only that many bytes, so one that found no file reads nothing and throws. Make a new one for each read.
- The view says "Saved" only once the server has said so, and says so when a load or a save fails.
- A collection that changes length is drawn with `list()`, never `.map()`.
- Icons are lucide, through `src/resources/icon.tsx`: `import { Trash2 } from "lucide"`, then `<Icon icon={Trash2} />` beside a label, or `<Icon icon={Trash2} label="Delete" />` alone, which is then read out. A test can find it as `svg.icon`.

`src/resources/<name>/<name>-api.ts`, following `message-api.ts`:

```ts
export type Message = { message: string };

const empty: Message = { message: "Hello" };

export function messageApi(dataDir: string) {
  const file = () => Bun.file(`${dataDir}/message.json`); // a new BunFile per call

  return {
    get: async () => {
      const stored = file();
      return Response.json(((await stored.exists()) ? await stored.json() : empty) satisfies Message);
    },
    put: async (req: Request) => {
      const body = await req.json().catch(() => null);
      if (typeof body?.message !== "string") {
        return Response.json({ error: "message must be a string" }, { status: 400 });
      }
      const message: Message = { message: body.message };
      await Bun.write(file(), JSON.stringify(message)); // creates the data folder if it is missing
      return Response.json(message);
    },
  };
}
```

`src/server.ts`, the routes written out:

```ts
const message = messageApi(dataDir); // in startServer
"/api/message": { GET: message.get, PUT: message.put }, // in routes
```

`<name>.ts`, the store, following `status.ts`:

```ts
import { signal } from "@blueshed/railroad";
import type { Status } from "./status-api";

/** What the server said about itself; null until the first load. */
export const status = signal<Status | null>(null);

export async function load() {
  const res = await fetch("/api/status");
  if (!res.ok) throw new Error(`GET /api/status answered ${res.status}`);
  status.set((await res.json()) as Status);
}
```

`<name>-view.tsx`, following `status-view.tsx`: `load()` in the component body, a `failed` signal, and `when(signal, (s$) => ...)` to draw once there is data. Then put the view in a route in `src/app.tsx`.

Tests, in a file of the resource's own, as `tests/message.test.ts` has them. The page helpers (`open`, `waitFor`, `replaceText`, `failFetch`, `withOtherWindow`) are in `tests/browser.ts`, and the Bun.WebView rules at the top of `tests/site.test.ts`:

```ts
test("PUT /api/message refuses a body that is not a message, and keeps the old one", async () => {
  for (const body of ["not json", "{}", JSON.stringify({ message: 1 })]) {
    const res = await putMessage(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "message must be a string" });
  }
});

test("a save the server did not take says Not saved", async () => {
  await open();
  await waitFor(`document.querySelector("textarea")`);
  await failFetch();
  await view.click("button.primary");
  await waitFor(`document.querySelector(".toast.show.alert")?.textContent === "Not saved"`);
});
```

## Push changes over the WebSocket

Step 2: `message` does this, so copy it.

`src/server.ts` has one socket for the app. Each resource that pushes is a topic:

```ts
// in routes:
"/ws": (req, server) =>
  server.upgrade(req) ? undefined : new Response("Upgrade required", { status: 426 }),

// beside routes:
websocket: {
  open(ws) {
    ws.subscribe("message"); // one line per resource that pushes
  },
  message() {}, // the page only listens
},
```

The handler that writes publishes what it wrote. A route handler's second argument is the server:

```ts
put: async (req: Request, server: Server<undefined>) => {
  // ... validate and write, as before
  server.publish("message", JSON.stringify(message)); // to every socket, the saver's included
  return Response.json(message);
},
```

The store listens, reopens a socket that closes, and loads again in case a write was missed:

```ts
function listen(again = false) {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => again && load().catch(() => {});
  ws.onmessage = (e) => message.set(JSON.parse(e.data) as Message);
  ws.onclose = () => setTimeout(() => listen(true), 1_000);
}
listen();
```

The view follows the signal, unless the box holds typing that has not been saved. `shown` is what it last took from the server. The second condition matters: without it, a window that saved stops following the others.

```tsx
let shown = text.peek();
effect(() => {
  const m = message.get();
  if (m && (text.peek() === shown || text.peek() === m.message)) {
    shown = m.message;
    text.set(m.message);
  }
});
```

Tests in `tests/message.test.ts` cover each case, and a new resource needs the same ones: `/ws` answers 426 over plain HTTP and a socket is told of a write; another window sees a save, and the first window then sees that window's save; typing that has not been saved is not overwritten; after a server restart the page loads what changed and follows again. `withOtherWindow` opens a second window and closes it in a `finally`.

Keep one replica on Railway: open sockets live in one process.

## Store in SQLite

Use `bun:sqlite`; never install a SQLite package. The database is a file in the data folder, so it is already git-ignored, and on Railway it is on the volume.

```ts
// src/resources/notes/notes-api.ts
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

export type Note = { id: number; text: string };

export function notesApi(dataDir: string) {
  mkdirSync(dataDir, { recursive: true }); // SQLite creates the file, not its folder
  const db = new Database(`${dataDir}/app.db`, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL)");

  return {
    list: () => Response.json(db.query<Note, []>("SELECT id, text FROM notes ORDER BY id").all()),

    add: async (req: Request) => {
      const body = await req.json().catch(() => null);
      if (typeof body?.text !== "string") {
        return Response.json({ error: "text must be a string" }, { status: 400 });
      }
      const note = db.query<Note, [string]>("INSERT INTO notes (text) VALUES (?) RETURNING id, text").get(body.text);
      return Response.json(note, { status: 201 });
    },
  };
}
// in startServer: const notes = notesApi(dataDir);
// in routes:      "/api/notes": { GET: notes.list, POST: notes.add },
```

The tests already give the server a scratch data folder, so each run has a fresh database:

```ts
test("notes are stored in SQLite and listed", async () => {
  expect(await (await api("/api/notes")).json()).toEqual([]);
  const post = await api("/api/notes", { method: "POST", body: JSON.stringify({ text: "first" }) });
  expect(post.status).toBe(201);
  expect(await post.json()).toEqual({ id: 1, text: "first" });
  expect(await (await api("/api/notes")).json()).toEqual([{ id: 1, text: "first" }]);
});

test("a note that is not text is refused", async () => {
  for (const body of ["not json", "{}", JSON.stringify({ text: 1 })]) {
    const res = await api("/api/notes", { method: "POST", body });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "text must be a string" });
  }
});
```

## Store in S3

Use `Bun.s3`; never install an AWS SDK. It is configured from `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (or their `AWS_` names), which Bun reads from `.env` or the environment when it starts, not from `process.env` later. On Railway they are a bucket's variables, named in `railway.ts` with `preserve()`. `startServer` takes the client as an option, `s3 = Bun.s3`, so that tests can pass their own.

```ts
// src/resources/files/files-api.ts
import type { BunRequest, S3Client } from "bun";

export function filesApi(s3: S3Client) {
  return {
    // Answers a redirect to a presigned URL: the bytes come from the bucket, not this server
    get: async (req: BunRequest<"/api/files/:name">) => {
      const file = s3.file(req.params.name);
      if (!(await file.exists())) return Response.json({ error: "no such file" }, { status: 404 });
      return new Response(file);
    },

    put: async (req: BunRequest<"/api/files/:name">) => {
      await s3.write(req.params.name, await req.blob());
      return new Response(null, { status: 204 });
    },
  };
}
// in startServer: const files = filesApi(s3);
// in routes:      "/api/files/:name": { GET: files.get, PUT: files.put },
```

Because of the redirect, the browser must be able to reach the bucket's endpoint. Tests need no real bucket: a stand-in of a few lines covers a write, `exists()` and a presigned read.

```ts
import { S3Client } from "bun";

const objects = new Map<string, Blob>();
const bucket = Bun.serve({
  port: 0,
  async fetch(req) {
    const key = new URL(req.url).pathname;
    if (req.method === "PUT") {
      objects.set(key, await req.blob());
      return new Response();
    }
    const object = objects.get(key);
    if (!object) return new Response(null, { status: 404 });
    return new Response(req.method === "HEAD" ? null : object, { headers: { "content-length": String(object.size) } });
  },
});
const s3 = new S3Client({ endpoint: bucket.url.href, bucket: "files", accessKeyId: "test", secretAccessKey: "test" });
// startServer({ ..., s3 }), and bucket.stop(true) in afterAll

test("a file is put in the bucket, and a GET redirects to it", async () => {
  expect((await api("/api/files/hello.txt", { method: "PUT", body: "hello, bucket" })).status).toBe(204);
  const res = await api("/api/files/hello.txt", { redirect: "manual" });
  expect(res.status).toBe(302);
  expect(await (await fetch(res.headers.get("location")!)).text()).toBe("hello, bucket");
});

test("a file that is not there is a 404", async () => {
  const res = await api("/api/files/nope.txt");
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "no such file" });
});
```

## Make it a delta document

Step 3. [@blueshed/delta](https://github.com/blueshed/delta) keeps the document, applies a write as JSON-Patch ops, and tells every open window. It rides one WebSocket, its browser side is a read-only railroad signal, and it reconnects by itself. This turns `message` into a document. Its HTTP routes go, and so do the app's own `/ws` and `websocket`, since delta owns `/ws`; another resource that still publishes there moves to a document too.

1. `bun add @blueshed/delta`, then `bunx @blueshed/delta install-skills`, then `rm -r .claude/skills/bun-route`: it is railroad's, and it scaffolds a bare project and tells a session to leave `development` (hot reload) on, where this app turns it off when `NODE_ENV` is `production`; the app was made without it. Read the `delta-doc` skill: one op vocabulary, and a document changes only by a send, whose op comes back and renders itself.

2. `message-api.ts` keeps only the type:

```ts
/** Message: the shape of the "message" document, shared by server and client. */
export type Message = { message: string };
```

3. `src/server.ts`: `startServer` becomes `async`, and `main.ts` awaits it (`const server = await startServer();`).

```ts
import { createWs, registerDoc } from "@blueshed/delta/server";
import type { Message } from "./resources/message/message-api";

// in startServer, before Bun.serve:
const ws = createWs();
await registerDoc<Message>(ws, "message", {
  file: `${dataDir}/message.json`,
  empty: { message: "Hello" },
});

// in routes, replacing "/api/message" and "/ws":
[ws.path]: ws.upgrade,

// replacing the websocket block:
websocket: ws.websocket,

// after Bun.serve (const server = Bun.serve({...})):
ws.setServer(server);
return server;
```

4. `message.ts`: the store is the document.

```ts
import { connectWs, openDoc } from "@blueshed/delta/client";
import type { Message } from "./message-api";

/** The "message" document. `message.data` is a read-only signal, null until it arrives: change it with `message.send`. */
export const message = openDoc<Message>("message", connectWs("/ws"));
```

5. `message-view.tsx`: the same following effect, reading `message.data`. Saving is a send, which resolves once the server has applied the write and told it back. There is no load to fail, so `failed` goes, with its `when()`.

```tsx
const text = signal(message.data.peek()?.message ?? "");
let shown = text.peek();
effect(() => {
  const doc = message.data.get();
  if (doc && (text.peek() === shown || text.peek() === doc.message)) {
    shown = doc.message;
    text.set(doc.message);
  }
});

async function onsave() {
  try {
    await message.send([{ op: "replace", path: "/message", value: text.peek() }]);
    toast("Saved");
  } catch {
    toast("Not saved", "alert");
  }
}
```

Tests: there is no HTTP for the message any more, so a test writes it the way a person does, in a window.

- The tests already await `startServer`, so `tests/site.test.ts` does not change; only `tests/message.test.ts` does.
- These go: `putMessage` and `failFetch`; the three `/api/message` route tests; the `BunFile` test; the `/ws` test; "the saved message is in the box"; "a save the server did not take says Not saved" (a save no longer uses `fetch`); "a message that cannot be loaded" (there is no load).
- "survives a reload" waits for `"Hello"` first and drops its `GET` check. The Cmd+Enter test checks with a reload instead of a `GET`.
- The two-window test starts from what the test before it left, with no `putMessage`. The unsaved-typing test drops its `GET` check.
- The restart test checks that the page follows again with a save from a second window:

```ts
  server = await startServer({ port, dev: false, dataDir });
  await waitFor(`document.querySelector("textarea")?.value === "changed while down"`);

  await withOtherWindow(async (other, waitForOther) => {
    await waitForOther(`document.querySelector("textarea")?.value === "changed while down"`);
    await other.click("textarea");
    await other.type("!");
    await other.click("button.primary");
  });
  await waitFor(`document.querySelector("textarea")?.value === "changed while down!"`);
```

A refused write rejects `send`, and the view says "Not saved": test your own refusals. On Railway one replica holds until the backend is Postgres.

## Beyond: eta

Step 4. eta draws the document on the server and states who may write what as stories. It is its own project, so nothing in this app runs or tests this step. Start from eta's own `first-app.md` and its `eta-app` skill; a resource's type and view are what you bring to it.

## Build for production

Optional. The app runs from source: `bun run start` serves `src/main.ts` with `NODE_ENV=production`, which turns hot reload off and bundles the page on its first request. Build only when a faster start or a single bundle is worth a step.

```json
"build": "bun build src/main.ts --target=bun --outdir=dist --production",
"serve:dist": "NODE_ENV=production bun --cwd dist main.js"
```

- `--production` matters: without it the built server runs with hot reload on.
- `dist/` is git-ignored. In `railway.ts`, `build: "bun install && bun run build"` and `start: "bun run serve:dist"`.
- Test it by building, spawning `main.js` in `dist/`, and checking the page has no `data-bun-dev-server-script`.

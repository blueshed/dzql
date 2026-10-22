# Patterns: email, jobs, files, other services, search, export

What a production app needs beyond its documents is a route, a job, or a hook after a write, and
it reaches the documents in one of two ways: `serverWrite(doc, ops)` (`dzql/rendering/documents`)
for a document the server keeps, off the ledger, in the app's scope (the cafe's `/scan`); or
`store.owner` (`openStore`'s), the server itself, through the documents as a page writes: their
rules, the ledger (by no one), every holder told. Nothing here writes a table by hand.

Working: none, as a whole: no example sends mail, runs a job, keeps files in a bucket or exports.
Each sketch is made of pieces shown working: `serverWrite` in a route, the cafe's
[`/scan`](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/cafe/routes.ts); `store.owner`'s writes and opens, and a custom
document beside a store's own, `tests/delta-pg/app-store-pglite.test.ts` and
`tests/delta-pg/app-store-signed-in-pglite.test.ts`; an upload route and its session's check, the
wedding's [`http.ts`](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/wedding/http.ts).

## Sending email

A write that lands puts a row in an outbox; a job sends it. A mail sent from inside the write
would hold it open on another service, and one lost to a restart is never sent.

```ts
// store.ts: the outbox, the app's own table, and a document over it no page reads
outbox: { columns: { to: "text", subject: "text", body: "text" }, temporal: false },
register([defineDoc("outbox:", { root: "outbox", include: [] })], { ledger: false });

// resources/request/request.ts: once a request has landed, its manager is told
async afterWrite(_ws, docId, ops) {
  if (!ops.some((op) => op.op === "add")) return;
  await store.owner.call("delta", { doc: "outbox:", ops: [{ op: "add", path: "/outbox/-", value: { to: managerOf(docId), subject: "A new request", body: "…" } }] });
},
```

- `afterWrite` runs once the write has landed: a throw there is reported, never a refusal
  ([resource.md](resource.md#after-a-write)). Never send from `permit` or `shape`.
- With delta's sign-in (`auth`), a document no person has says so: `register(docs, { owns: () => false })`;
  the owner passes every gate. A sign-in link by email is [signin.md](signin.md)'s.

## A background or scheduled job

A timer in the server, started with it and stopped as it stops, one run at a time:

```ts
// src/jobs.ts
import { pruneOpsLog } from "dzql/postgres";
import { store } from "./store";

async function sendMail(): Promise<void> {
  const { result } = await store.owner.call("open", { doc: "outbox:" });
  for (const mail of Object.values<{ id: number; to: string; subject: string; body: string }>(result?.outbox ?? {})) {
    const sent = await fetch(process.env.MAIL_URL!, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.MAIL_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(mail),
      signal: AbortSignal.timeout(10_000),
    });
    if (sent.ok) await store.owner.call("delta", { doc: "outbox:", ops: [{ op: "remove", path: `/outbox/${mail.id}` }] });
  }
}

/** Every minute while the server runs; its `close` stops it, before the store closes. */
export function jobs() {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // one run at a time: a slow one is not overtaken
    running = true;
    try {
      await sendMail();
      await pruneOpsLog(store.pool); // the catch-up log, an hour kept (deploy.md)
    } catch (err) {
      console.error("jobs:", err);
    } finally {
      running = false;
    }
  }, 60_000);
  return { routes: {}, close: [() => clearInterval(timer)] };
}

// src/routes.ts, in startServer: first in the compose, so it stops first
const served = await appOf(app, { dataDir });
return serve(compose(jobs(), served, modelling), { port });
```

- A job writes through the documents (`store.owner`), so every page that read one is told.
- The tests start the server too: a job they must not run waits for its first tick, or is left
  out (`startServer({ jobs: false })`, the app's own option).
- Each instance runs its own timer. Where it must run once, take a lock first, on one client:
  `SELECT pg_try_advisory_lock(hashtext('jobs'))`, and go on only if it answers true.
- A job at a time of day is a timer that asks the clock (`new Date().getUTCHours()`) and keeps
  what it last did in a row, so a restart neither skips nor repeats it.

## Storing files

The bytes go to a bucket (`Bun.s3`, which reads `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`
and `S3_SECRET_ACCESS_KEY` as Bun starts), never into a document or the container; a document
holds the file's key.

```ts
// routes.ts: put one in, as a session that may; read one back
"/api/files": async (req: Request) => {
  const cookie = cookieOf(req);
  if (req.method !== "POST" || !cookie || !(await mayUpload(await sessions.of(cookie)))) return new Response("Not yours to add", { status: 403 });
  const file = (await req.formData()).get("file");
  if (!(file instanceof File) || file.size > 8 * 1024 * 1024) return new Response("A file, 8MB at most", { status: 400 });
  const key = `${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
  await Bun.s3.write(key, file, { type: file.type });
  return Response.json({ key }); // the page writes the key onto its row, a write like any other
},
"/files/:key": (req) => Response.redirect(Bun.s3.file(req.params.key).presign({ expiresIn: 3600 }), 302),
```

- A form route asks `refuseOrigin(req)` (`@blueshed/delta/server`) first, as the cafe's `/scan` does.
- A test gives `startServer` its own S3 client, pointed at a stand-in `Bun.serve`: no credentials.

## Calling another service

In a route or a job, never in `permit` or `shape`: those hold the write while they wait, and a
service that is down is not the person's refusal. Give it a timeout, keep its secret in the
environment, and write what it answers through the documents:

```ts
const rate = await fetch(`https://rates.example.com/gbp?key=${process.env.RATES_KEY}`, { signal: AbortSignal.timeout(5_000) });
if (rate.ok) await store.owner.call("delta", { doc: "rates:1", ops: [{ op: "replace", path: "/rates/eur", value: (await rate.json()).eur }] });
```

## Search

A search is a document named by its words, worked out again on every write to what it reads: a
custom document (`defineCustomDoc`, `dzql/postgres`), registered beside the resource's own.

```ts
// resources/menu/menu-api.ts
const search = defineCustomDoc<string>("search:", {
  watch: ["items"],
  parse: (words) => decodeURIComponent(words),
  recompute: async (pool, words) => ({
    items: (await pool.query("SELECT id::int, name FROM current_items WHERE name ILIKE '%' || $1 || '%' ORDER BY name LIMIT 50", [words])).rows,
  }),
});
register([], { custom: [search] });
```

- The view reads `search:<words>` (`encodeURIComponent`), the words from where the tab stands
  ([bento.md](bento.md#where-you-are-the-address)): the page is told as the rows change.
- A temporal table is read through its `current_<table>` view. For many rows, Postgres's own
  full-text search (`to_tsvector(...) @@ plainto_tsquery($1)`), its index made in a migration's `up`.
- With sign-in, `recompute` reads as the person (`withAppAuth`) or, as the owner, only what
  everyone may see (`asOwner`, [rls.md](https://github.com/blueshed/dzql/blob/main/docs/postgres/rls.md)); and it says who has it (`owns` or `shared`).

## CSV export

A route, checked as the session it is, that opens the document and answers it as CSV:

```ts
// routes.ts
"/orders.csv": async (req: Request) => {
  const cookie = cookieOf(req);
  const sessionId = cookie && (await sessions.of(cookie));
  if (!sessionId || (await settled(activeDocuments(), () => visitOf(sessionId))).role !== "manager") return new Response("Not yours to export", { status: 403 });
  const { result } = await store.owner.call("open", { doc: "orders:" });
  const cell = (v: unknown) => `"${String(v ?? "").replace(/^[=+\-@]/, "'$&").replaceAll('"', '""')}"`; // no formula runs in a spreadsheet
  const rows = Object.values<{ dish_name: string; dish_price: number; status: string }>(result.orders);
  const csv = [["dish", "price", "status"], ...rows.map((o) => [o.dish_name, o.dish_price, o.status])].map((r) => r.map(cell).join(",")).join("\r\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="orders.csv"' } });
},
```

- `cookieOf` is `dzql/rendering/server`'s, `settled` and `activeDocuments` `dzql/rendering/documents`':
  the session read as the page reads it.
- With delta's sign-in, open it as the person (`store.delta.as(identity)`), so the document's path decides.
- An export is not a backup: that is `pg_dump` ([deploy.md](deploy.md#backups-and-what-to-watch)).

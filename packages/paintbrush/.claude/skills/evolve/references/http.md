# Serve what isn't communication

HTTP routes serve what isn't communication: the health check, files, the server's status. Files go in an S3 bucket through `Bun.s3`:

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
```

```ts
// src/routes.ts: after import { statusApi } from "./resources/status/status-api";
import { filesApi } from "./resources/files/files-api";
```

```ts
// src/routes.ts: after dataDir = process.env.DATA_PATH
s3 = Bun.s3,
```

```ts
// src/routes.ts: after const status = statusApi();
const files = filesApi(s3);
```

```ts
// src/routes.ts: after "/api/status": { GET: status.get },
"/api/files/:name": { GET: files.get, PUT: files.put },
```

Tests need no real bucket: a stand-in of a few lines answers a write, `exists()` and a presigned read.

```ts
// tests/files.test.ts
import { test, expect, afterAll } from "bun:test";
import { S3Client } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";

// A stand-in bucket: PUT keeps an object, HEAD and GET answer it
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

const dataDir = mkdtempSync(`${tmpdir()}/files-`);
const server = await startServer({ port: 0, dev: false, dataDir, s3 });
afterAll(async () => {
  await server.stop(true);
  await bucket.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});
const api = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init);

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

- Any other route copies `status` (`src/resources/status/`): a handler returning a `Response`; a signal and a `load()` that fetches; a view that calls `load()` in its body, keeps a `failed` signal, and draws with `when()` once there is data.
- `/health` is a route in `src/routes.ts`.
- Validate what a client sends and answer 400 with `{ error }`. Test every route and method, a 400 included. The view says when a load fails.
- Never install an AWS SDK. `Bun.s3` reads `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (or their `AWS_` names) from `.env` or the environment when Bun starts, not from `process.env` later.
- On Railway they are a bucket's variables, named in `.railway/railway.ts` with `preserve()`.
- `startServer` takes the client as an option, so tests pass their own.
- `new Response(file)` redirects to the bucket: the browser must be able to reach its endpoint.

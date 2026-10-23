# Serve what isn't communication

HTTP routes serve what isn't communication: the health check, files, the server's status. Files go in an S3 bucket through `Bun.s3`, never on the data volume, even while there is one server and the volume would hold them:

- A Railway volume belongs to one service. A second server cannot see it, and neither can the app once its documents move to Postgres across servers ([postgres.md](postgres.md)). The documents move by changing an import; files on the volume would have to be copied out, and their routes rewritten, on live data.
- A GET answers a redirect to the bucket, so a file's bytes never pass through the app's server, the one process that holds every socket.

The bucket costs the tests nothing: `startServer` takes the S3 client as an option (`s3`), and a test passes a stand-in for the bucket, a few lines of `Bun.serve`, with no credentials and no network. Only the running app needs a bucket's credentials (below).

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
// src/routes.ts: in place of export async function startServer(
export async function startServer({ port = undefined as number | undefined, dev = undefined as boolean | undefined, dataDir = process.env.DATA_PATH ?? `${import.meta.dir}/../data`, s3 = Bun.s3 } = {}) {
```

```ts
// src/routes.ts: after const status = statusApi();
const files = filesApi(s3);
```

```ts
// src/routes.ts: after "/api/status": { GET: status.get },
"/api/files/:name": { GET: files.get, PUT: files.put },
```

On the page, a file is made as anything is, in a modal: Upload beside the page's name opens it, its field takes the file (`type: "file"`, there in the form's data), and the cell keeps a link to each file this page put:

```ts
// src/resources/files/files.ts
import { signal } from "@blueshed/railroad";

/** A link to each file this page has put, the newest first. */
export const links = signal<{ name: string; href: string }[]>([]);

/** Puts a file on the site, and keeps its link. */
export async function upload(file: File) {
  const href = `/api/files/${encodeURIComponent(file.name)}`;
  const res = await fetch(href, { method: "PUT", body: file });
  if (!res.ok) throw new Error(`PUT ${href} answered ${res.status}`);
  links.set([{ name: file.name, href }, ...links.peek().filter((l) => l.href !== href)]);
}
```

```tsx
// src/resources/files/files-view.tsx
import { Upload } from "lucide";
import { bento, go, rowsOf } from "../bento";
import { toast } from "../toast";
import { links, upload } from "./files";

const { cell, row, tool, addModal } = bento();

/** The files on the box: a link to each this page put. */
export function FilesCell() {
  return cell({ name: "Files", body: rowsOf(links, (l) => l.href, (l$) => row({ what: () => l$.get().name, state: <a href={l$.peek().href}>Link</a> }), "No files yet.") });
}

/** Beside the page's name: a file to put. */
export const AddFile = () => tool("Upload", { icon: Upload, on: go("", "upload") });

/** What uploading asks over the box: the file. */
export function UploadModal() {
  const done = go("");
  return addModal("Upload a file", [{ name: "file", label: "The file", type: "file" }], (_, form) => void upload(form.get("file") as File).then(done, () => toast("Not uploaded", "alert")), done, "Upload");
}
```

```tsx
// src/app.tsx: after import { StatusCell } from "./resources/status/status-view";
import { AddFile, FilesCell, UploadModal } from "./resources/files/files-view";
```

```tsx
// src/app.tsx: after StatusCell(),
FilesCell(),
```

```tsx
// src/app.tsx: after const actions = (): Node[] => [
  AddFile(),
```

```tsx
// src/app.tsx: before return null; // nothing asks
if (at.what === "upload") return UploadModal();
```

Its story:

```ts
// stories.ts: after stories: {
  // Files
  files: story("A file put on the site can be fetched again, and one that is not there says so."),
```

Tests need no real bucket: a stand-in of a few lines answers a write, `exists()` and a presigned read.

```ts
// tests/files.test.ts
import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { S3Client } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import { stories } from "../stories";
import { browser } from "./browser";

setDefaultTimeout(30_000);

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
const { view, open, waitFor, close } = browser(() => server.url);
afterAll(async () => {
  close();
  await server.stop(true);
  await bucket.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});
const api = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init);

test(`${stories.stories.files.name} -- a file is put in the bucket, and a GET redirects to it`, async () => {
  expect((await api("/api/files/hello.txt", { method: "PUT", body: "hello, bucket" })).status).toBe(204);
  const res = await api("/api/files/hello.txt", { redirect: "manual" });
  expect(res.status).toBe(302);
  expect(await (await fetch(res.headers.get("location")!)).text()).toBe("hello, bucket");
});

test(`${stories.stories.files.name} -- a file that is not there is a 404`, async () => {
  const res = await api("/api/files/nope.txt");
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "no such file" });
});

test(`${stories.stories.files.name} -- on the page, a file put in the modal gives its link`, async () => {
  await open();
  await view.click(".heading > .tool"); // Upload, beside the page's name
  await waitFor(`document.querySelector("dialog input[name=file]")`);
  // a file chosen, as the picker would (a test cannot drive the system's picker)
  await view.evaluate(`(() => {
    const files = new DataTransfer();
    files.items.add(new File(["a photo"], "photo.jpg", { type: "image/jpeg" }));
    document.querySelector("dialog input[name=file]").files = files.files;
  })()`);
  await view.click("dialog .tool.add");
  await waitFor(`!document.querySelector("dialog")`); // the modal goes once it is put
  const href = await view.evaluate<string>(`document.querySelector('.cell[data-key="files"] .row a')?.getAttribute("href")`);
  expect(href).toBe("/api/files/photo.jpg");
  expect(await (await api(href)).text()).toBe("a photo");
});
```

Working: `tests/evolve.ts` makes a new app from this template, applies this page and runs its type check and tests (`bun run test:evolve`).

- An upload is made in a modal, as anything new is: `addModal`'s field `type: "file"`, and the file from the form's data, its second argument.
- Any other route copies `status` (`src/resources/status/`): a handler returning a `Response`; a signal and a `load()` that fetches; a view that calls `load()` in its body, keeps a `failed` signal, and draws with `when()` once there is data.
- `/health` is a route in `src/routes.ts`.
- Validate what a client sends and answer 400 with `{ error }`. Test every route and method, a 400 included. The view says when a load fails.
- Never install an AWS SDK. `Bun.s3` reads `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (or their `AWS_` names) from `.env` or the environment when Bun starts, not from `process.env` later.
- On Railway they are a bucket's variables, named in `.railway/railway.ts` with `preserve()`.
- `new Response(file)` redirects to the bucket: the browser must be able to reach its endpoint.

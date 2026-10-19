import type { Example } from "dzql/rendering/example";
import * as sessionDoc from "./documents/session";
import { picture, putPicture } from "./documents/wedding";
import { activeDocuments, settled } from "dzql/rendering/documents";
import { sessions } from "./delta";

// The two plain HTTP routes the site needs beside the kernel's: a picture by its key, and the
// couple putting one in. Neither is a document write: the key that lands on a row is written by
// the picture-field applet afterwards, over the websocket, like anything else.

const MAX_BYTES = 8 * 1024 * 1024;
const EXT: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/svg+xml": "svg", "image/gif": "gif", "image/jpeg": "jpg" };

export const routes: NonNullable<Example["routes"]> = {
  "/pictures/*": (req) => {
    const key = decodeURIComponent(new URL(req.url).pathname.slice("/pictures/".length));
    const p = picture(key);
    if (!p) return new Response("not found", { status: 404 });
    return new Response(p.bytes as unknown as BodyInit, { headers: { "content-type": p.type, "cache-control": "public, max-age=86400" } });
  },
  "/api/picture": async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const cookie = req.cookies.get("session_id");
    const sessionId = cookie ? await sessions.of(cookie) : undefined;
    if (!sessionId || (await settled(activeDocuments(), () => sessionDoc.read(sessionId))).kind !== "couple") return Response.json({ error: "only the couple keep pictures" }, { status: 403 });
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File) || !file.type.startsWith("image/")) return Response.json({ error: "an image, please" }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: "8MB at most" }, { status: 413 });
    const key = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${EXT[file.type] ?? "jpg"}`;
    putPicture(key, file.type, new Uint8Array(await file.arrayBuffer()));
    return Response.json({ key });
  },
};

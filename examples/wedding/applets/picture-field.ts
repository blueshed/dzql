// The picture field: the one thing on the site that is the browser's job before it is a write --
// choosing a file, drawing it down to a size a phone can send, and sending it. The bytes go to
// this example's /api/picture route, which keeps them and answers with a key; the key is then a
// plain write on the document (`replace /gifts/3/picture_key`), recorded and undoable like any other.

import { registerApplet } from "../../../src/applets";
import { esc } from "../views/html";

export interface PictureProps {
  doc: string;
  path: string;
  current: string | null;
}

/**
 * A phone's photograph is 4000px and many megabytes; a row's picture is 72px, the welcome's a
 * screen. So a photograph is drawn down to at most 1600px on its long side and sent as a JPEG. A
 * file the browser cannot draw (an SVG stays an SVG) goes as it is; the server's cap is 8MB.
 */
export async function downsized(file: File, max = 1600): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

function draw(el: HTMLElement, props: PictureProps, status = ""): void {
  el.innerHTML =
    `<span class="pic-field">` +
    (props.current ? `<img class="pic" src="/pictures/${esc(props.current)}" alt="">` : "") +
    `<button class="ghost" type="button">${props.current ? "Change picture" : "Picture"}</button>` +
    `<input type="file" accept="image/*" class="sr-only" aria-label="choose a picture">` +
    (status ? `<span class="note">${esc(status)}</span>` : "") +
    `</span>`;
}

const state = new WeakMap<HTMLElement, PictureProps>();

registerApplet("picture-field", {
  mount(el, ctx) {
    const props = ctx.props as PictureProps;
    state.set(el, props);
    draw(el, props);
    el.addEventListener("click", (e) => {
      if ((e.target as Element).closest("button")) el.querySelector("input")?.click();
    });
    el.addEventListener("change", async (e) => {
      const input = e.target as HTMLInputElement;
      const chosen = input.files?.[0];
      if (!chosen) return;
      const current = state.get(el)!;
      draw(el, current, "Sending…");
      const file = await downsized(chosen);
      const body = new FormData();
      body.set("file", file, file.name);
      try {
        const r = await fetch("/api/picture", { method: "POST", body });
        if (!r.ok) {
          draw(el, current, ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "The picture was not kept.");
          return;
        }
        const { key } = (await r.json()) as { key: string };
        ctx.send(current.doc, [{ op: "replace", path: current.path, value: key }]);
      } catch {
        draw(el, current, "Could not reach the site.");
      }
    });
    return () => state.delete(el);
  },
  update(el, props) {
    state.set(el, props as PictureProps);
    draw(el, props as PictureProps);
  },
});

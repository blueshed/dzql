/**
 * Toast — singleton notification utility.
 *
 * import { toast } from "../resources/toast";
 * toast("Saved");
 * toast("Deleted", "alert");
 */

let el: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout>;

export function toast(msg: string, style: "notify" | "alert" = "notify") {
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  clearTimeout(timer);
  el.textContent = msg;
  el.className = "toast show " + style;
  timer = setTimeout(() => el!.classList.remove("show"), 1500);
}

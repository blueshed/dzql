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
  el.setAttribute("role", style === "alert" ? "alert" : "status"); // heard by a screen reader, as it is shown
  timer = setTimeout(() => el!.classList.remove("show"), 1500);
}

/**
 * One browser on examples/lobby (tests/examples.test.ts): the page in happy-dom, its app.tsx over
 * Bun's own WebSocket to the server on PORT (run from examples/lobby, so Bun takes railroad's JSX
 * from its tsconfig). It says "ready" once the lobby and its colours show; with NAME, it joins as
 * NAME in COLOUR. It prints `here <who>` (name:colour, comma-separated) each time who is here
 * changes, and exits once it has shown each of SEE's states (`|`-separated) in turn; it fails
 * after 5 s.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const Native = globalThis.WebSocket;
GlobalRegistrator.register({ url: `http://localhost:${process.env.PORT}/` });
globalThis.WebSocket = Native;

const page = new URL("../../examples/lobby/", import.meta.url);
const html = await Bun.file(new URL("index.html", page)).text();
document.body.innerHTML = html.replace(/<!doctype html>/i, "").replace(/<script[^>]*><\/script>/, "");
await import(new URL("app.tsx", page).pathname);   // not a literal, so bun check leaves its JSX to the example's tsconfig

/** Who is here, as the page shows them: name:colour, by name. */
const here = () => [...document.querySelectorAll(".person")].map((p) =>
  `${p.querySelector(".name")!.textContent}:${/background:\s*([a-z]+)/.exec(p.querySelector(".swatch")!.getAttribute("style") ?? "")?.[1]}`).join(",");

for (let i = 0; i < 500 && !(document.getElementById("join") && document.querySelectorAll("option").length > 0); i++) await Bun.sleep(10);
console.log("ready");
if (process.env.NAME) {
  const form = document.getElementById("join") as HTMLFormElement;
  (form.elements.namedItem("name") as HTMLInputElement).value = process.env.NAME;
  (form.elements.namedItem("colour") as HTMLSelectElement).value = process.env.COLOUR ?? "";
  form.dispatchEvent(new Event("submit", { cancelable: true }));
}
const states = (process.env.SEE ?? "").split("|");
let shown: string | undefined;
for (let i = 0; i < 500 && states.length; i++) {
  if (here() !== shown) console.log(`here ${(shown = here())}`);
  if (shown === states[0]) states.shift();
  else await Bun.sleep(10);
}
process.exit(states.length ? 1 : 0);

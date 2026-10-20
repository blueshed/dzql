/**
 * One person's browser on examples/lists (tests/examples.test.ts): the page in happy-dom, its
 * app.tsx over Bun's own WebSocket to the server on PORT, carrying COOKIE on the upgrade as a
 * browser carries its session (run from examples/lists, so Bun takes railroad's JSX from its
 * tsconfig). Once signed in it prints `me <name>` and `lists <titles>`; then it does STEPS (a JSON
 * list) in turn on the list titled LIST -- ["add", item], ["see", item] (until it shows),
 * ["undo"] -- and exits once that list shows END (items, comma-separated), printing
 * `list <items>`, or fails after 5 s at any wait.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const Native = globalThis.WebSocket;
GlobalRegistrator.register({ url: `http://localhost:${process.env.PORT}/` });
globalThis.WebSocket = class extends Native {
  constructor(url: string | URL) {
    super(url, { headers: { cookie: process.env.COOKIE ?? "" } } as any);
  }
} as typeof WebSocket;

const page = new URL("../../examples/lists/", import.meta.url);
const html = await Bun.file(new URL("index.html", page)).text();
document.body.innerHTML = html.replace(/<!doctype html>/i, "").replace(/<script[^>]*><\/script>/, "");
await import(new URL("app.tsx", page).pathname);   // not a literal, so bun check leaves its JSX to the example's tsconfig

const wait = async (done: () => boolean, what: string) => {
  for (let i = 0; i < 500 && !done(); i++) await Bun.sleep(10);
  if (!done()) { console.log(`never: ${what}; the page says ${JSON.stringify(document.getElementById("root")!.textContent)}`); process.exit(1); }
};
const cards = () => [...document.querySelectorAll<HTMLElement>(".list")];
const card = () => cards().find((c) => c.querySelector("h2")!.textContent === process.env.LIST);
/** The items on LIST, in order. */
const items = () => [...(card()?.querySelectorAll(".item .title") ?? [])].map((t) => t.textContent);

await wait(() => !!document.getElementById("me")?.textContent && cards().length > 0 && cards().every((c) => c.querySelector("h2")!.textContent), "signed in, with lists");
console.log(`me ${document.getElementById("me")!.textContent}`);
console.log(`lists ${cards().map((c) => c.querySelector("h2")!.textContent).join(",")}`);

for (const [step, item] of JSON.parse(process.env.STEPS ?? "[]") as [string, string?][]) {
  if (step === "add") {
    await wait(() => !!card(), `the list ${process.env.LIST}`);
    const form = card()!.querySelector("form")!;
    (form.elements.namedItem("title") as HTMLInputElement).value = item!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await wait(() => items().includes(item!), `${item} added`);
  } else if (step === "see") {
    await wait(() => items().includes(item!), `${item} on ${process.env.LIST}`);
  } else if (step === "undo") {
    document.querySelector<HTMLButtonElement>("button.undo")!.click();
  }
}
await wait(() => items().join(",") === process.env.END, `${process.env.LIST} showing ${process.env.END}`);
console.log(`list ${items().join(",")}`);
process.exit(0);

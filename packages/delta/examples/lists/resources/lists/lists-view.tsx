/**
 * Lists' part of the page: Undo and Redo, then each list you are on, side by side, with who is on
 * it and its items. Each list is its own document, opened by its card and closed with it; a list
 * someone adds you to arrives through `mine:`, one you leave goes.
 *
 * Every change is one `send`; the echo draws it, here and on every page holding the list. Undo
 * is the ledger's: it walks back your last change, and leaves anyone else's.
 */
import { joinPath, type DeltaOp } from "@blueshed/delta/core";
import { computed, list, signal, type JSX, type ReadonlySignal } from "@blueshed/railroad";
import type { Person } from "../people/people-api";
import { openPeople } from "../people/people";
import type { Item, Member } from "./lists-api";
import { openList, openMine, redo, undo, type Walk } from "./lists";

/** What the last undo or redo said, when it did not do what was asked. */
const said = signal("");

async function walk(step: () => Promise<Walk>, none: string): Promise<void> {
  const done = await step();
  said.set(done === null ? none : done.conflict ? "Someone has changed that since: it stays as they left it." : "");
}

/** The lists `me` is on, and Undo and Redo, which walk back and forth through your own changes only. */
export function ListsView({ me }: { me: Person }): JSX.Element {
  const mine = openMine(me.id);
  const lists = mine.data.map((d) => Object.values(d?.members ?? {}).sort((a, b) => a.lists_id - b.lists_id));
  return (
    <>
      <p class="walk">
        <button class="undo" onclick={() => void walk(undo, "Nothing of yours to undo.")}>Undo</button>
        <button class="redo" onclick={() => void walk(redo, "Nothing to redo.")}>Redo</button>
        <span id="said">{said}</span>
      </p>
      <div class="lists">
        {list(lists, (m) => m.lists_id, (m$) => <ListCard id={m$.peek().lists_id} />)}
      </div>
    </>
  );
}

/** One list: its title, who is on it, its items (tick, ×), and a line to add one. */
function ListCard({ id }: { id: number }): JSX.Element {
  const doc = openList(id);
  const people = openPeople();
  const change = (ops: DeltaOp[]) => void doc.send(ops).catch((err) => said.set(err.message));
  const items = doc.data.map((d) => Object.values(d?.items ?? {}).sort((a, b) => a.id - b.id));
  // who is on it, by name: from both documents, so a change to either redraws it
  const who = computed(() => Object.values(doc.data.get()?.members ?? {})
    .map((m: Member) => people.data.get()?.people[m.person]?.name ?? "")
    .sort().join(", "));

  function add(e: SubmitEvent) {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem("title") as HTMLInputElement;
    if (input.value) change([{ op: "add", path: "/items/-", value: { title: input.value } }]);   // the server names it
    input.value = "";
  }

  const row = (item$: ReadonlySignal<Item>) => (
    <li class={item$.map((i) => (i.done ? "item done" : "item"))}>
      <input type="checkbox" checked={item$.map((i) => i.done)}
        onchange={() => change([{ op: "replace", path: joinPath("items", item$.peek().id, "done"), value: !item$.peek().done }])} />
      <span class="title">{item$.map((i) => i.title)}</span>
      <button class="remove" onclick={() => change([{ op: "remove", path: joinPath("items", item$.peek().id) }])}>×</button>
    </li>
  );

  return (
    <section class="list" data-list={String(id)}>
      <h2>{doc.data.map((d) => d?.lists.title ?? "")}</h2>
      <p class="who">{who}</p>
      <ul>{list(items, (i) => i.id, row)}</ul>
      <form onsubmit={add}><input name="title" autocomplete="off" placeholder="add an item" /></form>
    </section>
  );
}

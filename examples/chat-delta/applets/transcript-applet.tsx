/** @jsxImportSource @blueshed/railroad */
// The conversation as a railroad applet on the room's delta document. The server sends it the
// room's messages once, as props, in delta's own shape (a map keyed by id); after that every
// write reaches it as the room's echo -- delta's ops, whole rows -- which delta's `applyOps` lays
// onto the same map, and railroad's keyed `list()` redraws only the row that changed. No HTML
// follows a message (the room's `fragments` answers `[]`).
//
// Chat does not need this: its transcript loses nothing to a re-render. It is here to try the
// stack end to end: eta's page, a railroad applet, a delta document. Imported only by
// client/main.ts.

import { list, mount, signal, when, type ReadonlySignal, type Signal } from "@blueshed/railroad";
import { applyOps, type DeltaOp } from "@blueshed/delta/core";
import { registerApplet } from "../../../src/applets";

type Message = { id: string; name: string; text: string; sent_at: number };
type Props = { me: string; messages: Record<string, Message> };
type Row = Message & { mine: boolean; first: boolean };

const state = new WeakMap<HTMLElement, { props: Signal<Props>; dispose: () => void }>();

/** Oldest first (the ids are time-ordered), each knowing whether it is yours and whether it starts a run. */
function rows({ me, messages }: Props): Row[] {
  const ordered = Object.values(messages).sort((a, b) => (a.id < b.id ? -1 : 1));
  return ordered.map((m, i) => ({ ...m, mine: m.name === me, first: i === 0 || ordered[i - 1]!.name !== m.name }));
}

/** The same bubble the server draws for chat (compartments/room.ts's renderMessage). */
function Bubble(row: ReadonlySignal<Row>) {
  return (
    <li id={row.map((r) => `m${r.id}`)} class={row.map((r) => (r.mine ? "mine" : ""))}>
      <span class={row.map((r) => (r.mine ? "face me" : "face"))} aria-hidden="true">
        {row.map((r) => r.name.charAt(0).toUpperCase())}
      </span>
      <div class="body">
        {when(row.map((r) => !r.mine && r.first), () => <span class="name">{row.map((r) => r.name)}</span>)}
        <span class="bubble">{row.map((r) => r.text)}</span>
      </div>
    </li>
  );
}

function scrollToNewest(el: HTMLElement) {
  const ul = el.querySelector("ul");
  if (ul) ul.scrollTop = ul.scrollHeight;
}

registerApplet("transcript", {
  mount(el, ctx) {
    const props = signal(ctx.props as Props);
    const ordered = props.map(rows);
    const dispose = mount(el, () => <ul class="messages">{list(ordered, (r) => r.id, (row) => Bubble(row))}</ul>);
    state.set(el, { props, dispose });
    scrollToNewest(el);
    return () => {
      dispose();
      state.delete(el);
    };
  },
  // A render brought new props (someone came or went, or the page was redrawn whole): take them.
  update(el, props) {
    state.get(el)?.props.set(props as Props);
  },
  // The room's echo: delta's ops, laid onto the same map the props hold. The room's channel also
  // carries eta's own presence ops (`/people/...`), which are not delta's and not this applet's.
  patch(el, ops) {
    const s = state.get(el);
    const mine = (ops as DeltaOp[]).filter((op) => op.path.startsWith("/messages/"));
    if (!s || mine.length === 0) return;
    const next = structuredClone(s.props.peek());
    applyOps(next, mine);
    s.props.set(next);
    scrollToNewest(el);
  },
});

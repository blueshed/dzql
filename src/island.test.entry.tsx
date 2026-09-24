// Two islands for island.test.ts to drive in a real browser: one that takes its document's ops,
// and one that does not.
import type { Applet } from "./applets";
import { island } from "./island";

type Count = { n: number };

declare global {
  interface Window {
    counter: Applet;
    still: Applet;
  }
}

window.counter = island<Count>(
  (props, ctx, el) => {
    const drawn = el.textContent; // what the server rendered inside, read before it is replaced
    const more = () => ctx.send("count", [{ op: "replace", path: "/n", value: props.peek().n + 1 }]);
    return (
      <p>
        <span class="n">{props.map((p) => String(p.n))}</span>
        <button onclick={more}>+</button>
        <i>{drawn}</i>
      </p>
    );
  },
  (props, ops) => ops.reduce((p, op) => (op.path === "/n" ? { n: Number(op.value) } : p), props),
);

window.still = island<Count>((props) => <b>{props.map((p) => String(p.n))}</b>);

// The board applet's mounting: the state per element (props and the sparkline history derived
// from ticks seen so far), redrawn on mount, on a watchlist change, and on the market's own tick
// echo. Imported only by client/main.ts, like chat's room-picker -- not measured by the coverage
// table, since only a real browser drives it; the drawing and patch logic above it are
// (change-request.md item 4).

import { registerApplet } from "../../../src/applets";
import { applyOps, boardSvg, type BoardProps, type BoardState } from "./board";

const state = new WeakMap<HTMLElement, BoardState>();

const draw = (el: HTMLElement) => {
  el.innerHTML = boardSvg(state.get(el)!);
};

registerApplet("board", {
  mount(el, ctx) {
    const props = ctx.props as BoardProps;
    state.set(el, { props, history: Object.fromEntries(Object.entries(props.quotes).map(([s, q]) => [s, [q.prev, q.price]])) });
    draw(el);
    return () => state.delete(el);
  },
  // The watchlist changed: new symbols, the same market; the histories seen so far are kept.
  update(el, props) {
    const s = state.get(el);
    if (!s) return;
    const next = props as BoardProps;
    for (const [symbol, quote] of Object.entries(next.quotes)) if (!s.history[symbol]) s.history[symbol] = [quote.prev, quote.price];
    s.props = next;
    draw(el);
  },
  // A tick: the market's own op, straight from the echo. The row it touches is redrawn, and its
  // `up`/`down` class arriving fresh is what makes it flash.
  patch(el, ops) {
    const s = state.get(el);
    if (!s) return;
    if (applyOps(s, ops).length) draw(el);
  },
});

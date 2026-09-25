// The board applet's mounting: a row per watched symbol, each on its quote's own document, with
// its sparkline history derived from the ticks seen so far -- the state a render would destroy.
// Drawn on mount and on the quote's own tick echo. Imported only by client/main.ts -- not measured
// by the coverage table, since only a real browser drives it; the drawing and patch logic are
// board.ts.

import { registerApplet } from "../../../src/applets";
import { applyOps, drawRow, type RowProps, type RowState } from "./board";

const state = new WeakMap<HTMLElement, RowState>();

const draw = (el: HTMLElement) => {
  el.innerHTML = drawRow(state.get(el)!);
};

registerApplet("board", {
  mount(el, ctx) {
    const props = ctx.props as RowProps;
    state.set(el, { props, history: [props.quote.prev, props.quote.price] });
    draw(el);
    return () => state.delete(el);
  },
  // New props from a render (a name changed): the history seen so far is kept.
  update(el, props) {
    const s = state.get(el);
    if (!s) return;
    s.props = props as RowProps;
    draw(el);
  },
  // A tick: the quote's own op, straight from the echo. The row is redrawn, and its `up`/`down`
  // class arriving fresh is what makes it flash.
  patch(el, ops) {
    const s = state.get(el);
    if (s && applyOps(s, ops)) draw(el);
  },
});

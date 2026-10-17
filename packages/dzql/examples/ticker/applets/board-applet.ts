// The board applet's mounting: a row per watched symbol, each on its quote's own document, with
// its sparkline history derived from the ticks seen so far -- the state a render would destroy --
// and the same for the sparkline in a symbol's drawer. Drawn on mount and on the quote's own tick echo. Imported only by client/main.ts, and
// measured from the pages that run it (src/client-coverage.ts); the drawing and patch logic are
// board.ts.

import { registerApplet } from "dzql/rendering/applets";
import type { Applet } from "dzql/rendering/applets";
import { applyOps, drawRow, drawSpark, type RowProps, type RowState } from "./board";

const state = new WeakMap<HTMLElement, RowState>();

/** An applet on one quote that keeps the prices it has seen, drawn by `drawing`: a board row, or a drawer's sparkline. */
function onQuote(drawing: (s: RowState) => string): Applet {
  const draw = (el: HTMLElement) => {
    el.innerHTML = drawing(state.get(el)!);
  };
  return {
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
  };
}

registerApplet("board", onQuote(drawRow));
registerApplet("spark", onQuote(drawSpark));

// The list applet: every request, a row each, drawn only as it scrolls into view -- a year of a
// team's leave stays as quick as a week of it. The rows are ../calendar.ts's, the same the server
// draws first; a row is a button the kernel's client forwards, opening its drawer. Imported only
// by client/main.ts.

import { registerApplet } from "dzql/rendering/applets";
import { listRows, rowHtml, type ListProps } from "../calendar";

/** A row's height, in pixels: the list is as tall as its rows, drawn a window at a time. */
const ROW = 52;
/** Rows drawn beyond the window, above and below, so a quick scroll does not show a gap. */
const SPARE = 6;

type State = { props: ListProps };
const state = new WeakMap<HTMLElement, State>();

function paint(el: HTMLElement): void {
  const { props } = state.get(el)!;
  const rows = listRows(props);
  const view = el.querySelector<HTMLElement>(".vlist")!;
  const space = el.querySelector<HTMLElement>(".vspace")!;
  space.style.height = `${rows.length * ROW}px`;
  const first = Math.max(0, Math.floor(view.scrollTop / ROW) - SPARE);
  const last = Math.min(rows.length, Math.ceil((view.scrollTop + view.clientHeight) / ROW) + SPARE);
  space.innerHTML = rows
    .slice(first, last)
    .map((row, i) => `<div class="vitem" style="top: ${(first + i) * ROW}px">${rowHtml(row, props.open, first + i + 1, rows.length)}</div>`)
    .join("");
  el.querySelector<HTMLElement>(".vnone")!.hidden = rows.length > 0;
}

registerApplet("leave-list", {
  mount(el, ctx) {
    state.set(el, { props: ctx.props as ListProps });
    el.innerHTML = `<div class="vlist" role="list" aria-label="Every request"><div class="vspace"></div></div><p class="note vnone" hidden>Nobody has asked for leave.</p>`;
    el.querySelector(".vlist")!.addEventListener("scroll", () => paint(el), { passive: true });
    paint(el);
    return () => state.delete(el);
  },
  update(el, props) {
    const s = state.get(el);
    if (!s) return;
    s.props = props as ListProps;
    paint(el);
  },
});

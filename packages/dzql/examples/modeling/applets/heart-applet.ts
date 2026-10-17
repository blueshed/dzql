// The heart applet's mounting: the model's three columns, drawn by heart.ts from the model document
// it watches -- every patch delta tells laid on it by the kernel's client, and the columns drawn
// again -- with what the person looking has picked, hidden and opened, which a redraw would
// otherwise destroy. Click a story, a document or an entity and what goes with it lights in the
// other two; an entity's ⓘ says why it is marked. Imported only by client/main.ts -- not measured by
// the coverage table, since only a real browser drives it; the drawing is heart.ts.

import { registerApplet } from "../../../src/applets";
import { esc } from "../../../src/html";
import { CLOSE, drawHeart, heartOf, keyOf, reason, type Raw, type Sel, type Ui } from "../heart";

type State = { raw: Raw; ui: Ui };
const state = new WeakMap<HTMLElement, State>();

/** The popover over the page: the reason a mark stands for, placed under the mark. */
function drawPop(el: HTMLElement, s: State): void {
  const host = document.getElementById("pop");
  if (!host) return;
  const anchor = s.ui.pop && el.querySelector<HTMLElement>(`[data-mark="${CSS.escape(keyOf(s.ui.pop))}"]`);
  if (!s.ui.pop || !anchor) {
    host.innerHTML = "";
    return;
  }
  const why = reason(heartOf(s.raw), s.ui.pop);
  const at = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(at.right - 340, document.documentElement.clientWidth - 348));
  host.innerHTML = `<div class="pop${why.red ? " red" : ""}" role="dialog" aria-labelledby="pop-title" style="left:${left}px;top:${at.bottom + 6}px"><h3 id="pop-title">${esc(why.title)}</h3><p>${esc(why.one)}</p><p class="second">${esc(why.two)}</p><div class="acts"><button class="icon" data-act="close" data-key="close" aria-label="Close" title="Close">${CLOSE}</button></div></div>`;
}

function draw(el: HTMLElement): void {
  const s = state.get(el)!;
  const focused = (document.activeElement as HTMLElement | null)?.dataset.key;
  const fit = el.querySelector<HTMLElement>("#entities")?.clientWidth || el.clientWidth / 2;
  el.innerHTML = drawHeart(heartOf(s.raw), s.ui, fit);
  // laid out again at the width its column now has
  const width = el.querySelector<HTMLElement>("#entities")!.clientWidth;
  if (Math.abs(width - fit) > 1) el.innerHTML = drawHeart(heartOf(s.raw), s.ui, width);
  drawPop(el, s);
  if (focused) el.querySelector<HTMLElement>(`[data-key="${CSS.escape(focused)}"]`)?.focus();
}

registerApplet("heart", {
  mount(el, ctx) {
    const s: State = { raw: ctx.props as Raw, ui: { hideStories: false, hideEnts: false, pop: null } };
    state.set(el, s);
    const click = (e: Event) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-pick],[data-mark],[data-act]");
      if (!t) return;
      if (t.dataset.pick) {
        const [k, id] = t.dataset.pick.split(/:(.*)/) as [Sel["k"], string];
        s.ui.sel = k === "story" ? { k, id: Number(id) } : { k, id };
        s.ui.pop = null;
      } else if (t.dataset.mark) {
        const ent = t.dataset.mark.slice("ent:".length);
        s.ui.pop = s.ui.pop?.ent === ent ? null : { kind: "ent", ent };
      } else {
        if (t.dataset.act === "stories") s.ui.hideStories = !s.ui.hideStories;
        if (t.dataset.act === "ents") s.ui.hideEnts = !s.ui.hideEnts;
      }
      draw(el);
    };
    // the popover is outside the applet, at the page's foot: its close is heard there
    const closePop = (e: Event) => {
      if (!(e.target as HTMLElement).closest('#pop [data-act="close"]') && !(e instanceof KeyboardEvent && e.key === "Escape" && s.ui.pop)) return;
      const from = s.ui.pop;
      s.ui.pop = null;
      draw(el);
      if (from) el.querySelector<HTMLElement>(`[data-key="${CSS.escape(keyOf(from))}"]`)?.focus();
    };
    const follow = () => drawPop(el, s); // the popover is placed by its mark: it follows a column's scroll
    const resized = () => draw(el);
    el.addEventListener("click", click);
    document.addEventListener("click", closePop);
    document.addEventListener("keydown", closePop);
    document.addEventListener("scroll", follow, { capture: true, passive: true });
    addEventListener("resize", resized);
    draw(el);
    return () => {
      document.removeEventListener("click", closePop);
      document.removeEventListener("keydown", closePop);
      document.removeEventListener("scroll", follow, { capture: true });
      removeEventListener("resize", resized);
      document.getElementById("pop")?.replaceChildren();
      state.delete(el);
    };
  },
  // the model, patched as delta tells it, or a render's: drawn again, with what the person has picked
  update(el, props) {
    const s = state.get(el);
    if (!s) return;
    s.raw = props as Raw;
    draw(el);
  },
});

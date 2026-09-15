// The dressing applet's mounting: which part is open is this applet's own DOM state; a choice is
// one write on one field, and the figure redraws from the render that follows. Imported only by
// client/main.ts, like chat's room-picker -- not measured by the coverage table, since only a
// real browser drives it (client/app.test.ts); the drawing above it is (change-request.md item 4).

import { registerApplet } from "../../../src/applets";
import { dressHtml, type DressProps, type Part } from "./dress";

const state = new WeakMap<HTMLElement, { props: DressProps; open: Part | null }>();

const draw = (el: HTMLElement) => {
  const s = state.get(el)!;
  el.innerHTML = dressHtml(s.props, s.open);
};

registerApplet("dress", {
  mount(el, ctx) {
    state.set(el, { props: ctx.props as DressProps, open: null });
    draw(el);
    const act = (target: Element | null) => {
      const s = state.get(el)!;
      const part = target?.closest<HTMLElement>("[data-part]")?.dataset.part as Part | undefined;
      if (part) {
        s.open = s.open === part ? null : part;
        draw(el);
        return;
      }
      const choice = target?.closest<HTMLElement>("[data-field]");
      if (choice) ctx.send("household", [{ op: "replace", path: `/guests/${s.props.guestId}/minifigure/${choice.dataset.field}`, value: choice.dataset.value }]);
    };
    el.addEventListener("click", (e) => act(e.target as Element));
    el.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && (document.activeElement as Element | null)?.matches(".hit")) {
        e.preventDefault();
        act(document.activeElement);
      }
    });
    return () => state.delete(el);
  },
  update(el, props) {
    const s = state.get(el);
    if (!s) return;
    s.props = props as DressProps; // the open part stays open: the figure answers the touch, the sheet does not move
    draw(el);
  },
});

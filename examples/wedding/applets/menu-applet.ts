// The menu applet's mounting: which course is open is this applet's own DOM state; a choice is
// one write, and the pills redraw from the render that follows. Imported only by client/main.ts,
// like chat's room-picker -- not measured by the coverage table, since only a real browser drives
// it (client/app.test.ts); the drawing above it is (change-request.md item 4).

import { registerApplet } from "../../../src/applets";
import { menuHtml, type MenuProps } from "./menu";

const state = new WeakMap<HTMLElement, { props: MenuProps; open: number | null }>();

const draw = (el: HTMLElement) => {
  const s = state.get(el)!;
  el.innerHTML = menuHtml(s.props, s.open);
};

registerApplet("menu", {
  mount(el, ctx) {
    state.set(el, { props: ctx.props as MenuProps, open: null });
    draw(el);
    el.addEventListener("click", (e) => {
      const s = state.get(el)!;
      const target = e.target as Element;
      const pill = target.closest<HTMLElement>(".choice");
      if (pill) {
        const path = `/guests/${s.props.guestId}/choices/${pill.dataset.course}/${pill.dataset.kind}`;
        ctx.send("household", [pill.dataset.on === "true" ? { op: "remove", path } : { op: "replace", path, value: Number(pill.dataset.id) }]);
        return;
      }
      const head = target.closest<HTMLElement>(".menu-head");
      if (head) {
        const id = Number(head.dataset.course);
        s.open = s.open === id ? null : id;
        draw(el);
      }
    });
    return () => state.delete(el);
  },
  update(el, props) {
    const s = state.get(el);
    if (!s) return;
    s.props = props as MenuProps;
    draw(el);
  },
});

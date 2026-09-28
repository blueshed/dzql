// The photo applet's mounting: redrawn on every render that changes it -- but for find's fade,
// changed where each figure stands -- a newcomer walking in
// from the nearest side, the names coming down on the day, once the walk is over the attitude
// takes over. Imported only by client/main.ts, like chat's room-picker -- not measured by the
// coverage table, since only a real browser drives it (client/app.test.ts); the drawing above it
// is (change-request.md item 4).

import { registerApplet } from "../../../src/applets";
import { onlyFadeChanged, photoSvg, type PhotoProps } from "./photo";

const state = new WeakMap<HTMLElement, { props: PhotoProps; revealed: boolean }>();

function draw(el: HTMLElement, props: PhotoProps, arriving: Set<string>, descend: boolean): void {
  el.innerHTML = photoSvg(props.entries, props.label, arriving, descend);
  // once the walk is over, the attitude takes over
  for (const walk of el.querySelectorAll<SVGGElement>(".walk")) {
    walk.addEventListener("animationend", (e) => {
      if ((e as AnimationEvent).animationName === "walk-in") walk.querySelector(".fig")?.classList.remove("walking");
    });
  }
}

registerApplet("photo", {
  mount(el, ctx) {
    const props = ctx.props as PhotoProps;
    state.set(el, { props, revealed: !!props.reveal });
    draw(el, props, new Set(), !!props.reveal);
    const tap = (target: Element | null) => {
      const key = target?.closest<SVGGElement>("[data-key]")?.dataset.key;
      const entry = key === undefined ? undefined : state.get(el)?.props.entries.find((e) => e.key === key);
      if (entry?.tap) ctx.send(entry.tap.doc, [entry.tap.op]);
    };
    el.addEventListener("click", (e) => tap(e.target as Element));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        tap(document.activeElement);
      }
    });
    return () => state.delete(el);
  },
  update(el, next) {
    const props = next as PhotoProps;
    const prev = state.get(el);
    if (!prev) return;
    if (onlyFadeChanged(prev.props, props)) {
      // find looking: each figure fades or lights where it stands, mid-wave, and nobody walks in again
      for (const entry of props.entries) el.querySelector(`[data-slot="${CSS.escape(entry.key)}"]`)?.classList.toggle("hushed", !!entry.hushed);
      state.set(el, { ...prev, props });
      return;
    }
    const before = new Set(prev.props.entries.map((e) => e.key));
    const arriving = new Set(props.entries.filter((e) => !before.has(e.key)).map((e) => e.key));
    const descend = !!props.reveal && !prev.revealed;
    state.set(el, { props, revealed: !!props.reveal });
    draw(el, props, arriving, descend);
  },
});

// A Swiss railway clock's mounting: drawn and driven entirely in the browser, because the time is
// here, not on the server. The server mounts it once with the session's zone, and the only thing
// that ever crosses the wire for it afterwards is the clock document's own `replace /tz` when a
// city is chosen, which the applet takes itself. Imported only by client/main.ts, and measured
// from the pages that run it (src/rendering/client-coverage.ts); the drawing and time math are clock.ts
//.

import { registerApplet } from "dzql/rendering/applets";
import { clockSvg, handsAt, partsIn, timeSaid, tzAfter, type ClockProps } from "./clock";

/** What stops a clock's next turn: a frame, or a second's wait. */
const timers = new WeakMap<HTMLElement, () => void>();
const zones = new WeakMap<HTMLElement, { tz: string }>();

/** Asked on every turn, so the clock follows the reader's setting as it changes. */
const still = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

registerApplet("clock", {
  mount(el, ctx) {
    const zone = { tz: (ctx.props as ClockProps).tz };
    zones.set(el, zone);
    el.innerHTML = clockSvg();
    const face = el.querySelector<SVGElement>("svg.clock")!;
    const hour = el.querySelector<SVGElement>(".hand.hour")!;
    const minute = el.querySelector<SVGElement>(".hand.minute")!;
    const second = el.querySelector<SVGElement>(".hand.second")!;
    // Every frame the seconds hand sweeps; asked for no motion, the hand is put away (styles.css)
    // and the clock turns once a second, the hour and minute hands stepping as they always do.
    // The face's name is the time, said again only when the minute changes.
    const tick = () => {
      const t = partsIn(zone.tz);
      const angles = handsAt(t.hour, t.minute, t.second + t.ms / 1000);
      hour.setAttribute("transform", `rotate(${angles.hour.toFixed(2)})`);
      minute.setAttribute("transform", `rotate(${angles.minute})`);
      const said = timeSaid(t.hour, t.minute);
      if (face.getAttribute("aria-label") !== said) face.setAttribute("aria-label", said);
      if (still()) {
        const wait = setTimeout(tick, 1000 - t.ms);
        timers.set(el, () => clearTimeout(wait));
      } else {
        second.setAttribute("transform", `rotate(${angles.second.toFixed(2)})`);
        const frame = requestAnimationFrame(tick);
        timers.set(el, () => cancelAnimationFrame(frame));
      }
    };
    tick();
    return () => {
      timers.get(el)?.();
      timers.delete(el);
      zones.delete(el);
    };
  },
  update(el, props) {
    setZone(el, (props as ClockProps).tz);
  },
  // The city changed: the clock document's own op, off the echo. The hands follow on the next frame.
  patch(el, ops) {
    const zone = zones.get(el);
    if (zone) setZone(el, tzAfter(zone.tz, ops));
  },
});

function setZone(el: HTMLElement, tz: string): void {
  const zone = zones.get(el);
  if (zone) zone.tz = tz;
}

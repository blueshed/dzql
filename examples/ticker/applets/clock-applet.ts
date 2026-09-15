// A Swiss railway clock's mounting: drawn and driven entirely in the browser, because the time is
// here, not on the server. The server mounts it once with the session's zone, and the only thing
// that ever crosses the wire for it afterwards is the clock document's own `replace /tz` when a
// city is chosen, which the applet takes itself. Imported only by client/main.ts, like chat's
// room-picker -- not measured by the coverage table, since only a real browser drives it; the
// drawing and time math above it are (change-request.md item 4).

import { registerApplet } from "../../../src/applets";
import { cityOf, clockSvg, handsAt, partsIn, tzAfter, type ClockProps } from "./clock";

const timers = new WeakMap<HTMLElement, number>();
const zones = new WeakMap<HTMLElement, { tz: string }>();

registerApplet("clock", {
  mount(el, ctx) {
    const zone = { tz: (ctx.props as ClockProps).tz };
    zones.set(el, zone);
    el.innerHTML = clockSvg(cityOf(zone.tz));
    const hour = el.querySelector<SVGElement>(".hand.hour")!;
    const minute = el.querySelector<SVGElement>(".hand.minute")!;
    const second = el.querySelector<SVGElement>(".hand.second")!;
    const tick = () => {
      const t = partsIn(zone.tz);
      const angles = handsAt(t.hour, t.minute, t.second + t.ms / 1000);
      hour.setAttribute("transform", `rotate(${angles.hour.toFixed(2)})`);
      minute.setAttribute("transform", `rotate(${angles.minute})`);
      second.setAttribute("transform", `rotate(${angles.second.toFixed(2)})`);
      timers.set(el, requestAnimationFrame(tick));
    };
    tick();
    return () => {
      cancelAnimationFrame(timers.get(el) ?? 0);
      timers.delete(el);
      zones.delete(el);
    };
  },
  update(el, props) {
    setZone(el, (props as ClockProps).tz);
  },
  // The city changed: the clock document's own op, off the echo. The name changes now, the hands on the next frame.
  patch(el, ops) {
    const zone = zones.get(el);
    if (zone) setZone(el, tzAfter(zone.tz, ops));
  },
});

function setZone(el: HTMLElement, tz: string): void {
  const zone = zones.get(el);
  if (!zone) return;
  zone.tz = tz;
  const label = el.querySelector(".label");
  if (label) label.textContent = cityOf(tz);
}

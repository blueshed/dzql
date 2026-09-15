// A Swiss railway clock, as an applet: drawn and driven entirely in the browser, because the
// time is here, not on the server. The server mounts it once with the session's zone, and the
// only thing that ever crosses the wire for it afterwards is the clock document's own
// `replace /tz` when a city is chosen, which the applet takes itself. The seconds hand sweeps
// the minute in 58.5 seconds and waits at the top for the minute to catch up (the "stop to
// go"); the minute hand steps.

import { registerApplet } from "../../../src/applets";
import type { PatchOp } from "../../../src/json-patch";

export interface ClockProps {
  tz: string;
}

/** The city, as people say it: the zone's last segment, "New_York" as "New York". */
export const cityOf = (tz: string): string => (tz.split("/").pop() ?? tz).replaceAll("_", " ");

/** The zone after the clock document's ops: the last `replace /tz`, if any. */
export function tzAfter(tz: string, ops: PatchOp[]): string {
  for (const op of ops) if (op.op === "replace" && op.path === "/tz" && typeof op.value === "string") tz = op.value;
  return tz;
}

/** The sweep of the seconds hand: the whole dial in this many seconds, then a wait at twelve. */
export const SWEEP_S = 58.5;

/**
 * The hands' angles for a moment: hours and minutes as a station clock shows them (the minute
 * hand steps on the minute), seconds sweeping the dial in SWEEP_S then held at zero.
 */
export function handsAt(hour: number, minute: number, secondsInMinute: number): { hour: number; minute: number; second: number } {
  const second = Math.min(secondsInMinute / SWEEP_S, 1) * 360;
  return { hour: ((hour % 12) + minute / 60) * 30, minute: minute * 6, second };
}

/** The face, the city's name on it, and the hands at twelve; the applet turns them. */
export function clockSvg(city: string): string {
  const marks: string[] = [];
  for (let i = 0; i < 60; i++) {
    const big = i % 5 === 0;
    marks.push(`<rect x="${big ? -1.75 : -0.6}" y="-46" width="${big ? 3.5 : 1.2}" height="${big ? 12 : 3.5}" transform="rotate(${i * 6})"/>`);
  }
  return (
    `<svg class="clock" viewBox="-50 -50 100 100" width="120" height="120" aria-label="the time">` +
    `<circle class="face" r="49"/>` +
    `<g class="marks">${marks.join("")}</g>` +
    `<g class="hand hour"><rect x="-2.6" y="-30" width="5.2" height="42" rx="0.5"/></g>` +
    `<g class="hand minute"><rect x="-1.9" y="-44" width="3.8" height="56" rx="0.5"/></g>` +
    `<g class="hand second"><rect x="-0.6" y="-32" width="1.2" height="50"/><circle cy="-32" r="4.5"/></g>` +
    `<circle class="pin" r="1.4"/>` +
    `<text class="label" y="24" text-anchor="middle">${city.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</text>` +
    `</svg>`
  );
}

/** The wall-clock parts of `now` in a time zone. */
export function partsIn(tz: string, now = new Date()): { hour: number; minute: number; second: number; ms: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", minute: "numeric", second: "numeric", hour12: false }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: get("hour") % 24, minute: get("minute"), second: get("second"), ms: now.getMilliseconds() };
}

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

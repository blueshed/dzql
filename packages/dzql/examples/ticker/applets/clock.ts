// A Swiss railway clock's drawing and time math: the seconds hand sweeps the minute in 58.5
// seconds and waits at the top for the minute to catch up (the "stop to go"); the minute hand
// steps. Pure functions, tested here without a browser; the mounting that drives the hands every
// frame and takes the clock document's own patches is clock-applet.ts, imported only by
// client/main.ts.

import type { PatchOp } from "dzql/rendering/json-patch";

export interface ClockProps {
  tz: string;
}

/** The city, as people say it: the zone's last segment, "New_York" as "New York". */
export const cityOf = (tz: string): string => (tz.split("/").pop() ?? tz).replaceAll("_", " ");

/** The zone after the clock document's ops: the last one a replace of it says (`replace /tz`), if any. */
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

/** The time as a reader hears it, on a twenty-four-hour clock: "14:05". The face's own name, since its hands say nothing to one. */
export const timeSaid = (hour: number, minute: number): string => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

/** The face and the hands at twelve, named for a reader by the time; the applet turns them and keeps the name. The city is the cell's to say. */
export function clockSvg(): string {
  const marks: string[] = [];
  for (let i = 0; i < 60; i++) {
    const big = i % 5 === 0;
    marks.push(`<rect x="${big ? -1.75 : -0.6}" y="-46" width="${big ? 3.5 : 1.2}" height="${big ? 12 : 3.5}" transform="rotate(${i * 6})"/>`);
  }
  return (
    `<svg class="clock" viewBox="-50 -50 100 100" width="120" height="120" role="img" aria-label="the time">` +
    `<circle class="face" r="49"/>` +
    `<g class="marks">${marks.join("")}</g>` +
    `<g class="hand hour"><rect x="-2.6" y="-30" width="5.2" height="42" rx="0.5"/></g>` +
    `<g class="hand minute"><rect x="-1.9" y="-44" width="3.8" height="56" rx="0.5"/></g>` +
    `<g class="hand second"><rect x="-0.6" y="-32" width="1.2" height="50"/><circle cy="-32" r="4.5"/></g>` +
    `<circle class="pin" r="1.4"/>` +
    `</svg>`
  );
}

/** The wall-clock parts of `now` in a time zone. */
export function partsIn(tz: string, now = new Date()): { hour: number; minute: number; second: number; ms: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", minute: "numeric", second: "numeric", hour12: false }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: get("hour") % 24, minute: get("minute"), second: get("second"), ms: now.getMilliseconds() };
}

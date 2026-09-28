// The calendar applet: the drawing is ../calendar.ts, the same the server draws first; this adds
// the drags a server render would destroy mid-gesture. Across empty days, a drag (or a tap) is a
// draft, written when it is let go; on your own waiting request, a drag moves it and a grip
// stretches it, written when let go. While a drag is under way the calendar draws what it would
// be. A tap on a bar that did not move is left to the kernel's client: it opens the drawer.
// Imported only by client/main.ts, and driven by the browser test.

import { registerApplet } from "../../../src/applets";
import { addDays, calendarHtml, type CalendarProps, type Preview } from "../calendar";

type Drag =
  | { kind: "select"; anchor: string }
  | { kind: "move" | "start" | "end"; id: string; grab: string; starts: string; ends: string };

type State = { props: CalendarProps; preview: Preview | null; drag?: Drag; moved: boolean; pointer?: number };

const state = new WeakMap<HTMLElement, State>();

const draw = (el: HTMLElement) => {
  const s = state.get(el)!;
  el.innerHTML = calendarHtml(s.props, s.preview);
};

const DAY_MS = 86_400_000;
const between = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/** Follows a pointer wherever it goes, so a drag goes on over the edge of a bar or a week. */
function capture(el: HTMLElement, pointer: number): void {
  try {
    el.setPointerCapture(pointer);
  } catch {
    // a pointer the browser does not know (a test's): the drag still follows it over the calendar
  }
}

/** The day under a point: the week it is in, and its column of seven. */
function dayAt(x: number, y: number): string | null {
  const week = document.elementFromPoint(x, y)?.closest<HTMLElement>(".week");
  if (!week?.dataset.monday) return null;
  const r = week.getBoundingClientRect();
  return addDays(week.dataset.monday, Math.min(6, Math.max(0, Math.floor(((x - r.left) / r.width) * 7))));
}

registerApplet("calendar", {
  mount(el, ctx) {
    state.set(el, { props: ctx.props as CalendarProps, preview: null, moved: false });
    draw(el);
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const s = state.get(el)!;
      const target = e.target as Element;
      const bar = target.closest<HTMLElement>(".bar");
      const day = dayAt(e.clientX, e.clientY);
      if (!day) return;
      if (bar) {
        const r = bar.classList.contains("movable") ? s.props.team.requests.find((x) => x.id === bar.dataset.request) : undefined;
        if (!r) return; // someone else's, or answered: a tap opens its drawer, and nothing moves
        const grip = target.closest(".grip");
        s.drag = { kind: grip ? (grip.classList.contains("start") ? "start" : "end") : "move", id: r.id, grab: day, starts: r.starts, ends: r.ends };
      } else {
        s.drag = { kind: "select", anchor: day };
        s.preview = { id: null, starts: day, ends: day };
        draw(el);
      }
      s.moved = false;
      s.pointer = e.pointerId;
      // across empty days the drag starts at once; on a bar it starts only once it moves, so a
      // tap is still a tap on the bar, and opens its drawer (a captured pointer's click would land
      // on the calendar, not the bar)
      if (s.drag.kind === "select") capture(el, e.pointerId);
      e.preventDefault();
    });
    el.addEventListener("pointermove", (e) => {
      const s = state.get(el)!;
      const d = s.drag;
      const day = d && dayAt(e.clientX, e.clientY);
      if (!d || !day) return;
      let next: Preview;
      if (d.kind === "select") next = { id: null, starts: day < d.anchor ? day : d.anchor, ends: day < d.anchor ? d.anchor : day };
      else if (d.kind === "move") {
        const n = between(d.grab, day);
        next = { id: d.id, starts: addDays(d.starts, n), ends: addDays(d.ends, n) };
      } else if (d.kind === "start") next = { id: d.id, starts: day > d.ends ? d.ends : day, ends: d.ends };
      else next = { id: d.id, starts: d.starts, ends: day < d.starts ? d.starts : day };
      if (s.preview && s.preview.starts === next.starts && s.preview.ends === next.ends) return;
      if (d.kind !== "select" && next.starts === d.starts && next.ends === d.ends) return; // not moved off its own days yet
      if (d.kind !== "select" && !s.moved) capture(el, s.pointer!); // it is a drag now: follow it off the bar
      s.preview = next;
      s.moved = true;
      draw(el);
    });
    el.addEventListener("pointerup", () => {
      const s = state.get(el)!;
      const d = s.drag;
      const p = s.preview;
      s.drag = undefined;
      s.preview = null;
      if (!d || !p) return;
      if (d.kind === "select") ctx.send("team", [{ op: "replace", path: "/draft", value: { starts: p.starts, ends: p.ends } }]);
      else if (s.moved) ctx.send("team", [{ op: "replace", path: `/requests/${d.id}/starts`, value: p.starts }, { op: "replace", path: `/requests/${d.id}/ends`, value: p.ends }]);
      draw(el); // as it was, until the server draws it as it now is
    });
    // a bar dragged is not a bar tapped: its drawer does not open
    el.addEventListener(
      "click",
      (e) => {
        const s = state.get(el)!;
        if (!s.moved) return;
        s.moved = false;
        e.stopPropagation();
        e.preventDefault();
      },
      true,
    );
    return () => state.delete(el);
  },
  // the page drew it again -- a request moved, a month turned, a drawer opened: the new props
  update(el, props) {
    const s = state.get(el);
    if (!s) return;
    s.props = props as CalendarProps;
    s.preview = null;
    draw(el);
  },
});

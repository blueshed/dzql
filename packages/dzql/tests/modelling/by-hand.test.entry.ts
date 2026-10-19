// leave's client, its calendar made wrong where the page says how (`data-wrong` on its mount), for
// src/by-hand.test.ts: calendars a story done by hand must fail with. Without it, leave's own.
import { applets, registerApplet } from "../../src/rendering/applets";
import type { PatchOp } from "../../src/rendering/json-patch";
import "../../examples/leave/applets/calendar-applet";
import "../../examples/leave/applets/list-applet";

const calendar = applets.calendar!;
const draft: PatchOp = { op: "replace", path: "/draft", value: { starts: "2026-10-06", ends: "2026-10-07" } };

registerApplet("calendar", {
  ...calendar,
  mount(el, ctx) {
    const wrong = el.dataset.wrong ?? "";
    const send = ctx.send;
    // late-<ms>: it hears no pointer, and writes the story's draft by itself, that long after it is mounted
    if (wrong.startsWith("late-")) {
      for (const type of ["pointerdown", "pointermove", "pointerup", "click"]) el.addEventListener(type, (e) => e.stopImmediatePropagation(), true);
      setTimeout(() => send("session", [draft]), Number(wrong.slice(5)));
    }
    // unasked: another draft written by itself, as soon as the page is taken in hand (src/modelling/by-hand.ts)
    if (wrong === "unasked") {
      let hand: unknown;
      const other: PatchOp = { op: "replace", path: "/draft", value: { starts: "2026-10-13", ends: "2026-10-14" } };
      Object.defineProperty(window, "__hand", { configurable: true, get: () => hand, set: (v) => void ((hand = v), send("session", [other])) });
    }
    // twice: each write sent again, 100 ms after; half: each write's value a half day too
    const again = (doc: string, ops: PatchOp[]) => (send(doc, ops), void setTimeout(() => send(doc, ops), 100));
    const half = (doc: string, ops: PatchOp[]) => send(doc, ops.map((op) => ({ ...op, value: { ...(op.value as object), half: true } }) as PatchOp));
    return calendar.mount(el, { ...ctx, send: wrong === "twice" ? again : wrong === "half" ? half : send });
  },
});

await import("../../src/rendering/client/app");

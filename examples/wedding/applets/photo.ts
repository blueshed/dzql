// The photo applet's drawing: the crowd drawn from its props -- rows by proportion, bombers at
// the edges -- a newcomer walking in from the nearest side, the names coming down on the day. A
// tap on a figure sends the write its entry carries (open that guest's drawer; go to that
// family). The drawing is a string, so it's tested here without a browser; the mounting that
// touches the DOM is photo-applet.ts, imported only by client/main.ts (change-request.md item 4).

import type { PatchOp } from "../../../src/json-patch";
import { esc } from "../views/html";
import { arrange, figure, print, type Spec } from "./figure";

export type Tap = { doc: string; op: PatchOp };

export interface PhotoEntry {
  key: string;
  spec: Spec;
  /** A maybe stands in the photo as a ghost; so does a waiting ask in the family. */
  ghost?: boolean;
  /** Not coming: still, the mark at their feet saying no (the board shows everyone). */
  out?: boolean;
  /** A traffic light at the feet: whether this guest is coming, or a family figure's answer. */
  mark?: string;
  /** A family figure standing for this many: the count at its shoulder. */
  count?: number;
  /** What a tap on the figure writes, if anything. */
  tap?: Tap;
  /** This figure's drawer is open: rings (rule 13), scrolls into the clear beside it (K2). */
  chosen?: boolean;
  /** Find's word missed this one: it fades, never hides (rule 17), and a fade says nothing else. */
  hushed?: boolean;
}

export interface PhotoProps {
  entries: PhotoEntry[];
  label: string;
  /** The names are on the chests: the day has come. */
  reveal?: boolean;
}

const n = (x: number): string => x.toFixed(1);

/** Whether `next` differs from `prev` only in what find fades (rule 17): the same figures, in the
 * same order, alike in all else -- so the fade can change where they stand, not the photo be drawn again. */
export function onlyFadeChanged(prev: PhotoProps, next: PhotoProps): boolean {
  const still = (p: PhotoProps) => JSON.stringify({ ...p, entries: p.entries.map(({ hushed, ...rest }) => rest) });
  return still(prev) === still(next);
}

/** The photo as one SVG. `arriving` are the keys that walk in; `descend` makes the names come down from the top. */
export function photoSvg(entries: PhotoEntry[], label: string, arriving: Set<string> = new Set(), descend = false): string {
  const { slots, box } = arrange(entries.map((e) => e.spec));
  const marked = entries.some((e) => e.mark);
  const viewBox = `${box.x.toFixed(0)} ${box.y.toFixed(0)} ${box.w.toFixed(0)} ${(box.h + (marked ? 12 : 0)).toFixed(0)}`;
  let revealed = 0;
  const figures = slots.map((slot) => {
    const entry = entries[slot.k]!;
    const s = entry.spec;
    const classes = [entry.ghost && "ghost", entry.out && "out"].filter((c): c is string => typeof c === "string");
    // the name lives in the body so it rides a bounce or a lunge, and scales with the figure
    const chest = s.name
      ? descend
        ? print(s.name, s.top, "print descend").replace('class="print descend"', `class="print descend" style="--drop: ${((box.y - (slot.y + 73 * slot.s)) / slot.s).toFixed(0)}px; --i: ${revealed++}"`)
        : print(s.name, s.top)
      : undefined;
    let inner: string;
    if (slot.from) {
      // a bomber's lunge begins beyond the frame's edge, however far that is from their place
      const away =
        slot.from === "right" ? (box.x + box.w - slot.x) / slot.s
        : slot.from === "left" ? -(slot.x - box.x + 100 * slot.s) / slot.s
        : (box.y + box.h - slot.y) / slot.s; // from below: the head starts at the bottom edge
      inner = figure(s, { from: slot.from, classes, print: chest, style: `--lunge-from: ${away.toFixed(0)}px` });
    } else if (arriving.has(entry.key)) {
      // everyone else walks in from the nearest side, at their row's depth
      const fromLeft = slot.x + 50 * slot.s < box.x + box.w / 2;
      const away = fromLeft ? -(slot.x - box.x + 100 * slot.s) / slot.s : (box.x + box.w - slot.x) / slot.s;
      inner = `<g class="walk" style="--walk-from: ${away.toFixed(0)}px">${figure(s, { classes: [...classes, "walking"], print: chest })}</g>`;
    } else {
      inner = figure(s, { classes, print: chest });
    }
    const tap = entry.tap ? ` role="button" tabindex="0" data-key="${esc(entry.key)}" aria-expanded="${!!entry.chosen}"` : "";
    const reveal = entry.chosen ? ` data-reveal` : "";
    const mark = entry.mark ? `<circle class="mark mark-${esc(entry.mark)}" cx="50" cy="147" r="4.5"/>` : "";
    const count = entry.count && entry.count > 1 ? `<g class="count"><circle cx="82" cy="46" r="10"/><text x="82" y="49.5" text-anchor="middle">${entry.count}</text></g>` : "";
    // rule 13: a figure rings to show it is chosen -- an ellipse behind it, roughly its own bounds
    const ring = entry.chosen ? `<ellipse class="ring" cx="50" cy="72" rx="58" ry="80"/>` : "";
    const hush = entry.hushed ? " hushed" : "";
    return `<g class="slot${entry.chosen ? " chosen" : ""}${hush}" transform="translate(${n(slot.x)} ${n(slot.y)}) scale(${slot.s.toFixed(3)})"${tap}${reveal} data-slot="${esc(entry.key)}">${ring}${mark}${count}${inner}</g>`;
  });
  return `<svg class="photo" viewBox="${viewBox}" aria-label="${esc(label)}">${figures.join("")}</svg>`;
}

// The photo applet's drawing: the crowd drawn from its props -- rows by proportion, bombers at
// the edges -- a newcomer walking in from the nearest side, the names coming down on the day. A
// tap on a figure sends the write its entry carries (open that guest's drawer; go to that
// family). The drawing is a string, so it's tested here without a browser; the mounting that
// touches the DOM is photo-applet.ts, imported only by client/main.ts.

import type { PatchOp } from "dzql/rendering/json-patch";
import type { Figure } from "../resources/everyone/everyone-api";
import { esc } from "dzql/rendering/html";
import { arrange, figure, print, specOf, type Spec } from "./figure";

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
  /** The figure's name for someone who cannot see it, where no name is printed on it that says what a tap opens (a family's figure). */
  name?: string;
  /** This figure's drawer is open: rings, scrolls into the clear beside it (K2). */
  chosen?: boolean;
  /** Find's word missed this one: it fades, never hides, and a fade says nothing else. */
  hushed?: boolean;
}

export interface PhotoProps {
  entries: PhotoEntry[];
  label: string;
  /** The names are on the chests: the day has come. */
  reveal?: boolean;
}

const n = (x: number): string => x.toFixed(1);

/** Whether `next` differs from `prev` only in what find fades: the same figures, in the
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
    const tap = entry.tap ? ` role="button" tabindex="0" data-key="${esc(entry.key)}"${entry.name ? ` aria-label="${esc(entry.name)}"` : ""} aria-expanded="${!!entry.chosen}"` : "";
    const reveal = entry.chosen ? ` data-reveal` : "";
    const mark = entry.mark ? `<circle class="mark mark-${esc(entry.mark)}" cx="50" cy="147" r="4.5"/>` : "";
    const count = entry.count && entry.count > 1 ? `<g class="count"><circle cx="82" cy="46" r="10"/><text x="82" y="49.5" text-anchor="middle">${entry.count}</text></g>` : "";
    // a figure rings to show it is chosen -- an ellipse behind it, roughly its own bounds
    const ring = entry.chosen ? `<ellipse class="ring" cx="50" cy="72" rx="58" ry="80"/>` : "";
    const hush = entry.hushed ? " hushed" : "";
    return `<g class="slot${entry.chosen ? " chosen" : ""}${hush}" transform="translate(${n(slot.x)} ${n(slot.y)}) scale(${slot.s.toFixed(3)})"${tap}${reveal} data-slot="${esc(entry.key)}">${ring}${mark}${count}${inner}</g>`;
  });
  return `<svg class="photo" viewBox="${viewBox}" aria-label="${esc(label)}">${figures.join("")}</svg>`;
}

// ───────────────────────────── the families ─────────────────────────────

/** Up to this many guests, everyone stands in the photo; beyond it, the families do. */
export const EVERYONE_UP_TO = 16;

export interface Family {
  key: string;
  members: PhotoEntry[];
  /** On the chest of the family figure (the board: the household's code). */
  label?: string;
  mark?: string;
  ghost?: boolean;
  out?: boolean;
  /** What a tap on the family figure writes. */
  tap?: PhotoEntry["tap"];
  /** Find's word missed this whole family. */
  hushed?: boolean;
  /** Its drawer is open: the family figure rings. */
  chosen?: boolean;
}

/** A family's figure, named for a screen reader: a family of one by the person (or "a guest", while
 * the names are down until the day), a bigger one by the code on its chest where the couple see one,
 * and how many it stands for. */
function familyName(f: Family): string {
  if (f.members.length === 1) return f.members[0]!.spec.name ?? "a guest";
  return `${f.label ? `${f.label}, ` : ""}a family of ${f.members.length}`;
}

/**
 * The photo at its three levels: everyone, the families (one figure each, the first member's own
 * look, the count at the shoulder), or one family open. A map shows an area with how many sites
 * are within; the photo shows a family with how many are in it.
 */
export function familiesPhoto(families: Family[], open: string | null): { entries: PhotoEntry[]; label: string; level: "everyone" | "families" | "family"; shown: number } {
  const total = families.reduce((n, f) => n + f.members.length, 0);
  const family = open ? families.find((f) => f.key === open) : undefined;
  if (family) return { entries: family.members, label: "one family, as minifigures", level: "family", shown: family.members.length };
  if (total <= EVERYONE_UP_TO) return { entries: families.flatMap((f) => f.members), label: "the photo: everyone who has joined", level: "everyone", shown: total };
  const entries: PhotoEntry[] = families.map((f) => ({
    key: f.key,
    spec: { ...f.members[0]!.spec, name: f.label },
    name: familyName(f),
    ghost: f.ghost,
    out: f.out,
    mark: f.mark,
    count: f.members.length,
    tap: f.tap,
    hushed: f.hushed,
    chosen: f.chosen,
  }));
  return { entries, label: "the photo: the families", level: "families", shown: entries.length };
}

// ───────────────────────────── the photo of everyone ─────────────────────────────

/**
 * The photo of everyone's props: its document as delta holds it (`everyone:<wedding>`: who stands
 * in it, by guest id, and how many have claimed each gift, which it does not show), the family open
 * in it, and whether the names are down. The mount watches the document, so a look changed reaches
 * it as a patch, and what it shows is derived from these by `crowd`.
 */
export type CrowdProps = { everyone: { figures: Record<string, Figure> }; open: string | null; reveal: boolean };

/** Everyone in the photo, family by family in the order they joined, a maybe as a ghost, each family's tap opening it; the names only once they are down. */
function crowdFamilies({ everyone, reveal }: CrowdProps): Family[] {
  const byFamily = new Map<string, Family>();
  const figures = Object.entries(everyone.figures).sort(([a, x], [b, y]) => Number(x.household) - Number(y.household) || Number(a) - Number(b));
  for (const [id, f] of figures) {
    const key = String(f.household);
    const family = byFamily.get(key) ?? byFamily.set(key, { key, members: [], ghost: f.ghost, tap: { doc: "session", op: { op: "replace", path: "/page", value: `everyone/${key}` } } }).get(key)!;
    family.members.push({ key: id, ghost: f.ghost, spec: specOf(f.look, reveal ? (f.name ?? "") : undefined) });
  }
  return [...byFamily.values()];
}

/**
 * The photo of everyone, derived from its props: at whichever level the crowd and the open family
 * put it (`familiesPhoto`), and how many stand in it. Pure: the server runs it for the taps its
 * mount declares and the words beside it, and the applet (photo-applet.ts) again on each patch.
 */
export function crowd(p: CrowdProps): { photo: PhotoProps; level: "everyone" | "families" | "family"; shown: number; total: number; open: string | null } {
  const families = crowdFamilies(p);
  const open = p.open !== null && families.some((f) => f.key === p.open) ? p.open : null;
  const { entries, label, level, shown } = familiesPhoto(families, open);
  return { photo: { entries, label, reveal: p.reveal }, level, shown, total: families.reduce((n, f) => n + f.members.length, 0), open };
}

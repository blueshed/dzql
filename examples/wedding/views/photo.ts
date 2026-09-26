// The photo, wherever it is drawn: the household's family, everyone who has said yes, the board's
// families. What stands in it is decided here, on the server, from the documents; the drawing is
// the photo applet's (applets/photo.ts), which gets the entries as props and animates the changes.

import type { PhotoEntry } from "../applets/photo";
import type { HouseholdDocument } from "../documents/household";
import type { Spec } from "../applets/figure";
import { esc } from "./html";
import { address } from "../../../src/bento";
import { part } from "../../../src/parts";
import { isGuestOut, specOf } from "./shared";

export type { PhotoEntry };

/** The ghost of someone asked for: a blank figure in paper, named for them, until the couple's yes makes a guest. */
export const ghostSpec = (name: string): Spec => ({
  skin: "#E9E1CD", hair: "none", hair_color: "#E9E1CD", top: "#E9E1CD", legs: "#E9E1CD", face: "smile", attitude: "nodding", name,
});

/** The photo applet's mount point, keyed by `id` so a fragment render can replace just it. */
export function photoMount(id: string, entries: PhotoEntry[], label: string, reveal = false): string {
  return part(id, `<div id="${esc(id)}" data-applet="photo" data-props="${esc(JSON.stringify({ entries, label, reveal }))}"></div>`);
}

/** The household's guests as photo entries -- a tap opens the guest's drawer, and rings while it
 * is open (`focus`, rule 13) -- with a waiting ask as a ghost, still: someone asked for, not yet a
 * guest, with nothing of theirs to open. */
export function familyEntries(h: HouseholdDocument, live?: { path: string; focus?: number }): PhotoEntry[] {
  const entries: PhotoEntry[] = h.guests.map((g) => ({
    key: String(g.id),
    out: isGuestOut(g, h),
    spec: specOf(g.minifigure, g.name.split(/\s+/)[0]),
    tap: live ? { doc: "session", op: { op: "replace", path: "/page", value: address(live.path, "guest", g.id) } } : undefined,
    chosen: !!live && g.id === live.focus,
  }));
  for (const a of h.asks) {
    if (a.reply !== null) continue;
    entries.push({ key: `ask-${a.id}`, ghost: true, spec: ghostSpec(a.name.split(/\s+/)[0]!) });
  }
  return entries;
}

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
  /** Find's word missed this whole family (rule 17). */
  hushed?: boolean;
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
    ghost: f.ghost,
    out: f.out,
    mark: f.mark,
    count: f.members.length,
    tap: f.tap,
    hushed: f.hushed,
  }));
  return { entries, label: "the photo: the families", level: "families", shown: entries.length };
}

// The photo, wherever it is drawn: the household's family, everyone who has said yes, the board's
// families. What stands in it is decided here, on the server, from the documents; the drawing is
// the photo applet's (applets/photo.ts), which gets the entries as props and animates the changes.

import type { PhotoEntry } from "../applets/photo";
import type { HouseholdDocument } from "../documents/household";
import type { Spec } from "../applets/figure";
import { appletWrites, esc } from "./html";
import { address } from "../../../src/bento";
import { part } from "../../../src/parts";
import { guestMark, isGuestOut, matches, specOf } from "./shared";

export type { PhotoEntry };

/** The ghost of someone asked for: a blank figure in paper, named for them, until the couple's yes makes a guest. */
export const ghostSpec = (name: string): Spec => ({
  skin: "#E9E1CD", hair: "none", hair_color: "#E9E1CD", top: "#E9E1CD", legs: "#E9E1CD", face: "smile", attitude: "nodding", name,
});

/** The photo applet's mount point, keyed by `id` so a fragment render can replace just it. It says where each tap goes (`appletWrites`, with the value), as a button would. */
export function photoMount(id: string, entries: PhotoEntry[], label: string, reveal = false): string {
  const taps = entries.flatMap((e) => (e.tap ? [[e.tap.doc, e.tap.op.op, e.tap.op.path, e.tap.op.value as string] as const] : []));
  return part(id, `<div id="${esc(id)}" data-applet="photo" data-props="${esc(JSON.stringify({ entries, label, reveal }))}"${taps.length ? appletWrites(...taps) : ""}></div>`);
}

/** The household's guests as photo entries, each with whether they are coming at their feet -- a
 * tap opens the guest's drawer, and rings while it is open (`focus`, rule 13) -- with a waiting ask
 * as a ghost, still: someone asked for, not yet a guest, with nothing of theirs to open. Find's word
 * (rule 17) fades whoever it misses, by name, and fading means nothing else; with the eye, they
 * step out of the photo. */
export function familyEntries(h: HouseholdDocument, live?: { path: string; focus?: number }, find: { word?: string; hide?: boolean } = {}): PhotoEntry[] {
  const misses = (name: string) => find.word !== undefined && !matches(name, find.word);
  const entries: PhotoEntry[] = h.guests.map((g) => ({
    key: String(g.id),
    out: isGuestOut(g, h),
    mark: guestMark(g, h),
    spec: specOf(g.minifigure, g.name.split(/\s+/)[0]),
    tap: live ? { doc: "session", op: { op: "replace", path: "/page", value: address(live.path, "guest", g.id) } } : undefined,
    chosen: !!live && g.id === live.focus,
    hushed: misses(g.name),
  }));
  for (const a of h.asks) {
    if (a.reply !== null) continue;
    entries.push({ key: `ask-${a.id}`, ghost: true, spec: ghostSpec(a.name.split(/\s+/)[0]!), hushed: misses(a.name) });
  }
  return find.hide ? entries.filter((e) => !e.hushed) : entries;
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
  /** Its drawer is open: the family figure rings (rule 13). */
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

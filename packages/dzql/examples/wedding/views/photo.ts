// The photo, wherever it is drawn: the household's family, everyone who has said yes, the board's
// families. What stands in the household's and the board's is decided here, on the server, from the
// documents; the drawing is the photo applet's (applets/photo.ts), which gets the entries as props
// and animates the changes. The photo of everyone watches its document instead, and what stands in
// it is derived in the applet's own module (`crowd`), on the server and in the browser alike.

import type { PhotoEntry } from "../applets/photo";
export { familiesPhoto, type Family } from "../applets/photo";
import type { HouseholdDocument } from "../documents/household";
import type { Spec } from "../applets/figure";
import { appletProps, appletWrites, esc } from "./html";
import { address } from "dzql/rendering/bento";
import { part } from "dzql/rendering/parts";
import { guestMark, isGuestOut, matches } from "./shared";
import { specOf } from "../applets/figure";

export type { PhotoEntry };

/** The ghost of someone asked for: a blank figure in paper, named for them, until the couple's yes makes a guest. */
export const ghostSpec = (name: string): Spec => ({
  skin: "#E9E1CD", hair: "none", hair_color: "#E9E1CD", top: "#E9E1CD", legs: "#E9E1CD", face: "smile", attitude: "nodding", name,
});

/** Where each figure's tap goes, as its mount says it (`appletWrites`, with the value), as a button would; nothing when none has one. */
export function tapsOf(entries: PhotoEntry[]): string {
  const taps = entries.flatMap((e) => (e.tap ? [[e.tap.doc, e.tap.op.op, e.tap.op.path, e.tap.op.value as string] as const] : []));
  return taps.length ? appletWrites(...taps) : "";
}

/** The photo applet's mount point, keyed by `id` so a fragment render can replace just it, drawn from the entries it is sent. It says where each tap goes. */
export function photoMount(id: string, entries: PhotoEntry[], label: string, reveal = false): string {
  return part(id, `<div id="${esc(id)}" data-applet="photo"${appletProps({ entries, label, reveal })}${tapsOf(entries)}></div>`);
}

/** The household's guests as photo entries, each with whether they are coming at their feet -- a
 * tap opens the guest's drawer, and rings while it is open (`focus`) -- with a waiting ask
 * as a ghost, still: someone asked for, not yet a guest, with nothing of theirs to open. Find's word
 * fades whoever it misses, by name, and fading means nothing else; with the eye, they
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

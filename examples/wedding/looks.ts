// The values a minifigure's look may take: the model's lists (brief.md: a face, an attitude, a
// hair) and the palette (the save-the-date's own colours). Shared by the documents, which refuse
// any other value on the wire, and by the views, which offer exactly these.

export const ATTITUDES = ["waving", "nodding", "laughing", "cool", "photo-bombing"] as const;
export type Attitude = (typeof ATTITUDES)[number];
export const HAIRS = ["none", "short", "bob", "long", "curls"] as const;
export type Hair = (typeof HAIRS)[number];
/** The guest's own: eyes, mouth and brows, whatever the attitude. Exasperated is happy and ironic (the brows raised over a smile); laugh is the open mouth. */
export const FACES = ["smile", "grin", "wink", "wry", "exasperated", "laugh"] as const;
export type Face = (typeof FACES)[number];

/**
 * Every colour offered, in one order: skins from fair to deep, then the save-the-date's ink, navy,
 * lilac, rose, burgundy, gold and leaf, then paper. Each part's palette lists the ones it offers in
 * this order and no other, so a colour sits in the same place relative to its neighbours wherever
 * it appears.
 */
export const COLOURS = [
  "#F2C86A", "#E0A97A", "#C98E5A", "#A96A48", "#7A4A2E", "#5C3A22", // skins
  "#2B2B33", "#1E3F8F", "#B8A4CB", "#C97D83", "#7B2F4B", "#C9A227", "#7FAE4E", // the save-the-date
  "#E9E1CD", "#FBF9F4", // paper
];
const inOrder = (xs: string[]): string[] => [...xs].sort((a, b) => COLOURS.indexOf(a) - COLOURS.indexOf(b));

/** Which of the colours each part may take, always in the one order. */
export const PALETTE = {
  skin: inOrder(["#F2C86A", "#E0A97A", "#C98E5A", "#A96A48", "#7A4A2E", "#5C3A22"]),
  hair: inOrder(["#2B2B33", "#5C3A22", "#A96A48", "#C9A227", "#E9E1CD", "#7B2F4B"]),
  top: inOrder(["#7B2F4B", "#1E3F8F", "#7FAE4E", "#B8A4CB", "#C9A227", "#C97D83", "#2B2B33", "#FBF9F4"]),
  legs: inOrder(["#1E3F8F", "#2B2B33", "#C97D83", "#E9E1CD", "#7B2F4B", "#7FAE4E"]),
};

/** A minifigure's look, as the minifigures table holds it. */
export type Look = {
  skin: string;
  hair: Hair;
  hair_color: string;
  top: string;
  legs: string;
  face: Face;
  attitude: Attitude;
  built_at: string | null;
};

export const LOOK_FIELDS = ["skin", "hair", "hair_color", "top", "legs", "face", "attitude"] as const;
export type LookField = (typeof LOOK_FIELDS)[number];

const ALLOWED: Record<LookField, readonly string[]> = {
  skin: PALETTE.skin,
  hair: HAIRS,
  hair_color: PALETTE.hair,
  top: PALETTE.top,
  legs: PALETTE.legs,
  face: FACES,
  attitude: ATTITUDES,
};

export function isLookField(field: string): field is LookField {
  return (LOOK_FIELDS as readonly string[]).includes(field);
}

/** Whether `value` is one of the values `field` may take. */
export function allowsLook(field: LookField, value: unknown): value is string {
  return typeof value === "string" && ALLOWED[field].includes(value);
}

// The dressing applet's drawing: a minifigure drawn for being changed, so it holds still, and
// every part a finger can change carries a callout -- hair, face, top, arms, legs -- each a lead
// from the part to a label beside it, the way an instruction sheet names the pieces. Touch a part
// or its label and that part's choices appear beside it: heads for the hairs and the faces, dots
// for the colours, small moving figures for the attitudes. The drawing is a string, so it's
// tested here without a browser; the mounting that touches a part and turns a tap into a write is
// dress-applet.ts, imported only by client/main.ts (see change-request.md item 4).

import { ATTITUDES, FACES, HAIRS, PALETTE, type Attitude, type LookField } from "../looks";
import { esc } from "../views/html";
import { figure, figureSvg, print, type Spec } from "./figure";

export const PARTS = ["hair", "face", "top", "arms", "legs"] as const;
export type Part = (typeof PARTS)[number];

export interface DressProps {
  guestId: number;
  spec: Spec;
  firstName: string;
  /** Not coming: faded. */
  out?: boolean;
}

/** Where a finger lands (`hit`) and where the callout leads from (`lead`), in the figure's own units. */
const GEOMETRY: Record<Part, { hit: { x: number; y: number; w: number; h: number }; lead: { x: number; y: number } }> = {
  arms: { hit: { x: 6, y: 46, w: 88, h: 54 }, lead: { x: 78, y: 94 } },
  top: { hit: { x: 28, y: 50, w: 44, h: 46 }, lead: { x: 76, y: 70 } },
  legs: { hit: { x: 24, y: 103, w: 52, h: 37 }, lead: { x: 75, y: 122 } },
  face: { hit: { x: 30, y: 16, w: 40, h: 35 }, lead: { x: 69, y: 33 } },
  hair: { hit: { x: 26, y: 0, w: 48, h: 17 }, lead: { x: 70, y: 8 } },
};
const SAYS: Record<Part, string> = { hair: "hair and its colour", face: "face and skin", top: "top", arms: "arms — the attitude", legs: "legs" };

/** A small head, for a hair or a face to choose from: the figure rendered and cropped to the head. An attitude with no prop on the face (the glasses are cool's). */
const headIcon = (spec: Spec): string => figureSvg({ ...spec, attitude: "waving" }, 40, { viewBox: "24 -2 52 52", height: 43 });

/** The touched part's choices. Each button carries the field and the value it writes. */
export function partPop(part: Part, spec: Spec, firstName: string): string {
  const set = (field: LookField, value: string) => ` data-field="${field}" data-value="${esc(value)}"`;
  const dots = (label: string, current: string, colours: string[], field: LookField): string =>
    `<div class="dots" role="radiogroup" aria-label="${esc(`${firstName}’s ${label}`)}">${colours
      .map((c) => `<button type="button" class="dot${current === c ? " on" : ""}" role="radio" aria-checked="${current === c}" aria-label="${esc(`${label} ${c}`)}" style="background:${c}"${set(field, c)}></button>`)
      .join("")}</div>`;
  const heads = (label: string, current: string, values: readonly string[], field: LookField): string =>
    `<div class="icons" role="radiogroup" aria-label="${esc(`${firstName}’s ${label}`)}">${values
      .map((v) => `<button type="button" class="icon${current === v ? " on" : ""}" role="radio" aria-checked="${current === v}" aria-label="${esc(`${label} ${v}`)}"${set(field, v)}>${headIcon({ ...spec, [field]: v })}</button>`)
      .join("")}</div>`;
  const attitudes = (current: Attitude): string =>
    `<div class="icons attitudes" role="radiogroup" aria-label="${esc(`${firstName}’s attitude`)}">${ATTITUDES.map(
      (a) => `<button type="button" class="icon tall${current === a ? " on" : ""}" role="radio" aria-checked="${current === a}" aria-label="${esc(`attitude ${a}`)}"${set("attitude", a)}>${figureSvg({ ...spec, attitude: a }, 34)}<span class="icon-name">${a}</span></button>`,
    ).join("")}</div>`;
  const body =
    part === "hair" ? heads("hair", spec.hair, HAIRS, "hair") + dots("hair colour", spec.hair_color, PALETTE.hair, "hair_color")
    : part === "face" ? heads("face", spec.face, FACES, "face") + dots("skin", spec.skin, PALETTE.skin, "skin")
    : part === "top" ? dots("top", spec.top, PALETTE.top, "top")
    : part === "legs" ? dots("legs", spec.legs, PALETTE.legs, "legs")
    : attitudes(spec.attitude);
  return `<div class="pop pop-${part}" role="group" aria-label="${esc(`${firstName}’s ${SAYS[part]}`)}">${body}</div>`;
}

/** The sheet of parts, in three columns: the figure with a lead from every part; the titles at their parts' heights; the open part's choices. */
export function dressHtml(props: DressProps, open: Part | null): string {
  const { spec, firstName } = props;
  const leads = (Object.keys(GEOMETRY) as Part[]).map((part) => {
    const { hit, lead } = GEOMETRY[part];
    const on = open === part ? " on" : "";
    return (
      `<line class="lead lead-${part}${on}" x1="${lead.x}" y1="${lead.y}" x2="100" y2="${lead.y}"/>` +
      `<circle class="lead-dot lead-${part}${on}" cx="${lead.x}" cy="${lead.y}" r="2.4"/>` +
      `<rect class="hit hit-${part}${on}" x="${hit.x}" y="${hit.y}" width="${hit.w}" height="${hit.h}" rx="6" role="button" tabindex="0" aria-label="${esc(`${firstName}’s ${SAYS[part]}`)}" aria-expanded="${open === part}" data-part="${part}"/>`
    );
  });
  const svg = `<svg class="dress-figure" viewBox="0 0 100 140" aria-label="${esc(`${firstName}, as a minifigure: touch a part to change it`)}">${figure(spec, { classes: props.out ? ["out"] : [], print: print(firstName, spec.top) })}${leads.join("")}</svg>`;
  const callouts = PARTS.map(
    (part) =>
      `<button type="button" class="callout callout-${part}${open === part ? " on" : ""}" style="--y: ${GEOMETRY[part].lead.y}" aria-expanded="${open === part}" aria-label="${esc(`${firstName}’s ${SAYS[part]}`)}" data-part="${part}">${part}</button>`,
  );
  return `<div class="dress">${svg}<div class="callouts">${callouts.join("")}</div><div class="options">${open ? partPop(open, spec, firstName) : ""}</div></div>`;
}

import { address, prop, type Placeable } from "dzql/rendering/bento";
import { appletWrites, esc } from "dzql/rendering/html";
import { surfaces } from "../../surfaces";
import { ZONES, cityOf, offsetOf, type ClockDocument } from "./clock-api";

// The clock's part of the page: a thing on the box, its face an applet, whose drawer holds the city.

const { cell, drawer, go } = surfaces;

// Every zone as "City (UTC+02:00)" -- or "City, Region (UTC-03:00)" where the zone names one --
// the options the city picker reads at mount. Offsets move with the clocks twice a year, so the
// list is rebuilt when a minute has passed.
let zoneOptions = "";
let zoneOptionsAt = 0;
export function zoneLabel(tz: string, now = new Date()): string {
  const parts = tz.split("/");
  const region = parts.length > 2 ? parts[1]!.replaceAll("_", " ") : "";
  return `${cityOf(tz)}${region ? `, ${region}` : ""} (UTC${offsetOf(tz, now)})`;
}
export function zoneOptionsHtml(now = Date.now()): string {
  if (now - zoneOptionsAt > 60_000) {
    zoneOptions = ZONES.map((tz) => `<option value="${esc(tz)}">${esc(zoneLabel(tz, new Date(now)))}</option>`).join("");
    zoneOptionsAt = now;
  }
  return zoneOptions;
}

/** The clock's face; the cell's summary names the city. */
const clockMount = (c: ClockDocument): string => `<div id="clock" data-applet="clock" data-doc="clock" data-props="${esc(JSON.stringify({ tz: c.tz }))}"></div>`;
// the picker's zones are its children, HTML the server wrote; the applet reads them once and draws its own field
const cityMount = (c: ClockDocument): string => `<div id="city" class="city" data-applet="city-picker" data-doc="clock"${appletWrites(["clock", "replace", "/tz"])} data-props="${esc(JSON.stringify({ tz: c.tz }))}"><datalist>${zoneOptionsHtml()}</datalist></div>`;

/** The clock on the box: a thing, its face, its city; tapped, its drawer opens over the desk. */
export const clockCell = (c: ClockDocument, chosen: boolean): Placeable =>
  cell({ key: "clock", name: "the clock", mark: "clock", summary: c.city, body: `<div class="mini face">${clockMount(c)}</div>`, thing: { open: go(address("", "clock")), chosen } });

/** The clock's drawer: the city to choose, and its offset. */
export const clockDrawer = (c: ClockDocument, close: string): string =>
  drawer("drawer", "Time zone", `<div class="props">${prop("City", cityMount(c))}${prop("Offset", `<span>UTC${esc(c.offset)}</span>`)}</div>`, close);

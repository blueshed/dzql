import { address, layers, parseAddress } from "dzql/rendering/bento";
import { nextMonth, prevMonth, stillMine } from "./calendar";
import { surfaces } from "./surfaces";
import { read as sessionOf } from "./resources/session/session-api";
import { draftSheet, signInPage } from "./resources/session/session-view";
import { read as teamOf } from "./resources/team/team-api";
import { calendarMount, listMount, requestSheet, takeBack } from "./resources/team/team-view";

// leave's page, drawn by the server for whoever is looking, from the parts each resource draws
// (`resources/<name>/<name>-view.ts`). Signed out: sign in. Signed in: one calendar -- or the same
// requests as a list -- and one drawer. You drag across days for a draft, and its drawer says what
// it would mean before you ask: how many working days, who else is off. Your own waiting requests
// you drag to move. A request's drawer is where a manager answers, and where you change or take
// back your own. The drawers' fields do everything a drag does, for a keyboard.

const { tool, collectionPage, addTool, go, site, readingSwitch } = surfaces;

/** The page for a session, where it stands (`page`, kept on the session). */
export function render(sessionId: string): string {
  const { person: me, page, draft } = sessionOf(sessionId);
  if (!me) return layers(signInPage(sessionId), "", ""); // the bento's frame, so the door is drawn with its controls
  const t = teamOf();
  const { path, what, which } = parseAddress(page);
  const today = new Date().toISOString().slice(0, 10);
  const list = path === "list";
  const from = list || path === "" ? today.slice(0, 7) : path; // the calendar starts at the month its address names, or this one
  const open = what === "request" || what === "confirm" ? which! : null;

  // the reading: the calendar or the list, the same requests; from the list, the calendar is today's
  const readings: [text: string, mark: "month" | "list", on: boolean, w: string][] = [
    ["Calendar", "month", !list, go(list ? "" : path)],
    ["List", "list", list, go("list")],
  ];
  const reading = readingSwitch(readings);
  const ask = addTool(go(address(path, "draft")), "Ask for leave");
  const tools = list
    ? [ask]
    : [
        // a month at a time, each by its own name, so every month is somewhere a person can get to,
        // whatever today is; the page alone is today, wherever that is
        tool("Previous", { icon: "chevron-left", iconOnly: true, write: go(prevMonth(from)) }),
        tool("Today", { icon: "today", iconOnly: true, pressed: from === today.slice(0, 7), write: go("") }),
        tool("Next", { icon: "chevron-right", iconOnly: true, write: go(nextMonth(from)) }),
        ask,
      ];
  const body = list ? listMount({ me: me.id, team: t, open }) : calendarMount({ from, today, me: me.id, team: t, draft, open, place: path });
  const r = open === null ? undefined : t.requests.find((x) => x.id === open);
  const drawer = what === "request" && r ? requestSheet(t, me, r, path, sessionId) : what === "draft" ? draftSheet(t, me, draft, path, sessionId) : "";
  const modal = what === "confirm" && r && stillMine(me, r) ? takeBack(r, path) : "";
  return site(page, layers(collectionPage([{ label: t.name }], { key: "leave", reading, tools, body }), drawer, modal));
}

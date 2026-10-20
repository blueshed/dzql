import type { PatchOp } from "dzql/rendering/json-patch";
import { post, story, type Stories, type Write } from "dzql/modelling/stories";
import { mondayOf } from "./calendar";

// A small team asks for days off, told as stories. See docs/stories.md. It is the example
// that needs to know who you are: Ann and Bo ask, Mo manages and answers, and a visitor who has
// not signed in may do nothing. Signing in is not a write -- a password never crosses the wire --
// so the cast signs in through the example's own sign-in page (`signIn`), and the stories start
// from there. The page is one calendar: a person drags across days for a draft, sees what it
// would mean -- how many working days, who else is off -- and asks for it; their own waiting
// requests they drag to move. A place is a month (`2026-10`) or the list, and what is open over it:
// a tab's own, its URL, so a link opens on it and a second tab may stand somewhere else.
//
// Bo has asked for a week in October (request 1) and Ann for a day in November (request 2), both
// waiting for Mo; Mo has approved Ann's days before Christmas (request 3), and taken a week in
// October himself (request 4): a manager's own leave is approved at once, by him, for all to see.
// Ann has a draft in October, not yet asked for; Bo's draft is only a weekend; Mo's is in November.

const session = (...ops: PatchOp[]): Write => ({ doc: "session", ops });
const draft = (starts: string, ends: string): Write => session({ op: "replace", path: "/draft", value: { starts, ends } }); // yours alone until you ask
const askDraft: Write = { doc: "team", ops: [{ op: "add", path: "/requests/-" }] };
const move = (id: number, starts: string, ends: string): Write => ({ doc: "team", ops: [{ op: "replace", path: `/requests/${id}/starts`, value: starts }, { op: "replace", path: `/requests/${id}/ends`, value: ends }] });
const answer = (id: number, status: "approved" | "declined"): Write => ({ doc: "team", ops: [{ op: "replace", path: `/requests/${id}/status`, value: status }] });
const withdraw = (id: number): Write => ({ doc: "team", ops: [{ op: "remove", path: `/requests/${id}` }] });

// Where a drag on the calendar starts and ends (a story's `gesture`, done by hand in a browser the
// size of a phone): a day, its date in its week's row of its month; a request, its bar.
const day = (date: string): string => `.week[data-month="${date.slice(0, 7)}"][data-monday="${mondayOf(date)}"] > .date:nth-child(${((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1})`;
const bar = (id: number): string => `.bar[data-request="${id}"]`;

export const stories = {
  cast: { ann: [draft("2026-10-08", "2026-10-12")], bo: [draft("2026-10-10", "2026-10-11")], mo: [draft("2026-11-23", "2026-11-24")], visitor: [] },
  signIn: (name) => (name === "visitor" ? undefined : { path: "/login", form: { email: `${name}@leave.example`, password: `${name}-password` } }),
  goTo: (address) => session({ op: "replace", path: "/page", value: address }),
  stories: {
    // ── asking: a draft first, to see what it would mean ──
    annDragsAcross: story("Ann drags across two days in Bo's week, and sees the clash before she asks", { as: "ann", from: "2026-10", does: draft("2026-10-06", "2026-10-07"), gesture: { drag: [day("2026-10-06"), day("2026-10-07")] }, seen: { ann: "2026-10" } }),
    annAsksDraft: story("Ann asks for her draft, and Mo and Bo see it waiting on the calendar, and she sees it waiting in her drawer", { as: "ann", from: "2026-10?draft", does: askDraft, seen: { ann: "2026-10", mo: "2026-10", bo: "2026-10" } }),
    annSetsDraft: story("Ann sets her draft's last day before its first, and is told so", { as: "ann", from: "2026-10?draft", cannot: session({ op: "replace", path: "/draft/ends", value: "2026-10-01" }), told: "The last day is before the first." }),
    boAsksDraft: story("Bo asks for a draft that is only a weekend, and is told it has no working days", { as: "bo", from: "2026-10?draft", cannot: askDraft, told: "There are no working days in those." }),

    // ── moving what is still waiting ──
    annDragsDay: story("Ann drags her day in November to the Friday after, and Mo and Bo see it move", { as: "ann", from: "2026-11", does: move(2, "2026-11-20", "2026-11-20"), gesture: { drag: [bar(2), day("2026-11-20")] }, seen: { ann: "2026-11", mo: "2026-11", bo: "2026-11" } }),
    boTakesBack: story("Bo takes back his week in October before Mo has answered", { as: "bo", from: "2026-10?confirm=1", does: withdraw(1), seen: { bo: "2026-10", mo: "2026-10", ann: "2026-10" } }),

    // ── a manager's own leave ──
    moAsksDays: story("Mo asks for two days in November, and as the manager they are approved at once, by him", { as: "mo", from: "2026-11?draft", does: askDraft, seen: { mo: "2026-11", ann: "2026-11", bo: "2026-11" } }),
    moMovesWeek: story("Mo moves the week he approved for himself, and the team sees it move", { as: "mo", from: "2026-10", does: move(4, "2026-10-26", "2026-10-30"), gesture: { drag: [bar(4), day("2026-10-28")] }, seen: { mo: "2026-10", ann: "2026-10", bo: "2026-10" } }), // grabbed at its middle, the Wednesday
    moTakesBack: story("Mo takes back the week he approved for himself", { as: "mo", from: "2026-10?confirm=4", does: withdraw(4), seen: { mo: "2026-10", ann: "2026-10", bo: "2026-10" } }),

    // a value of the wrong type, refused by the permit as the schema would: no field on the page sends it, so by hand it is not tried
    annNumberDay: story("Ann cannot move her day in November to a number: a day is a date", { as: "ann", from: "2026-11?request=2", cannot: { doc: "team", ops: [{ op: "replace", path: "/requests/2/starts", value: 20261120 }] } }),

    // ── answering ──
    moApprovesBo: story("Mo approves Bo's week from its drawer, and Bo sees it approved", { as: "mo", from: "2026-10?request=1", does: answer(1, "approved"), seen: { mo: "2026-10?request=1", bo: "2026-10", ann: "2026-10" } }),
    moDeclinesAnn: story("Mo declines Ann's day in November, and Ann sees it declined", { as: "mo", from: "2026-11?request=2", does: answer(2, "declined"), seen: { mo: "2026-11?request=2", ann: "2026-11", bo: "2026-11" } }),

    // ── what nobody may do ──
    annCannotApproveOwn: story("Ann cannot approve her own day off", { as: "ann", from: "2026-11?request=2", cannot: answer(2, "approved") }),
    onlyManagerAnswers: story("Only a manager answers: Ann cannot approve Bo's week", { as: "ann", from: "2026-10?request=1", cannot: answer(1, "approved") }),
    annCannotMoveBo: story("Ann cannot move Bo's week", { as: "ann", from: "2026-10", cannot: move(1, "2026-10-12", "2026-10-16") }),
    annCannotMoveDays: story("Ann cannot move days Mo has already approved", { as: "ann", from: "2026-12?request=3", cannot: move(3, "2026-12-28", "2026-12-31") }),
    annCannotTakeBackMos: story("Ann cannot take back Mo's week", { as: "ann", from: "2026-10?request=4", cannot: withdraw(4) }),
    annCannotTakeBackBos: story("Ann cannot take back Bo's request", { as: "ann", cannot: withdraw(1) }),
    visitorCannotAsk: story("A visitor who has not signed in cannot ask for leave", { as: "visitor", cannot: askDraft }),
    annCannotMakeHerself: story("Ann cannot make herself a manager", { as: "ann", cannot: { doc: "team", ops: [{ op: "replace", path: "/people/1/role", value: "manager" }] } }),
    annCannotBecomeMo: story("Ann cannot become Mo over the wire", { as: "ann", cannot: session({ op: "replace", path: "/person_id", value: "3" }) }),

    // ── coming and going ──
    annOpensNovember: story("Ann opens November in a second tab, and her first stays on October", { as: "ann", from: "2026-10", opensTab: "2026-11", seen: [] }), // each tab its own screen
    moFollowsLink: story("Mo follows a link to Bo's request, and his new tab opens on its drawer; the tab he had open stays where it was", { as: "mo", opensTab: "2026-10?request=1", seen: [] }), // a URL is a page
    boSignsAnother: story("Bo signs in on another phone, and sees the team's calendar", { as: "visitor", does: post("/login", { email: "bo@leave.example", password: "bo-password" }), seen: ["visitor"] }),
    someoneTypesBo: story("Someone types Bo's email with the wrong password, and is told the two do not match", { as: "visitor", cannot: post("/login", { email: "bo@leave.example", password: "not-it" }), told: "That email and password do not match." }),
    annSignsOut: story("Ann signs out, and her page asks her to sign in", { as: "ann", from: "", does: session({ op: "remove", path: "/person_id" }), seen: ["ann"] }), // from the calendar: on a phone her draft's drawer covers the page's tools
  },
} satisfies Stories;

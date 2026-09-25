import type { PatchOp } from "../../src/json-patch";
import { story, type Stories, type Write } from "../../src/stories";

// A small team asks for days off, told as stories. See stories.md at the root. It is the example
// that needs to know who you are: Ann and Bo ask, Mo manages and answers, and a visitor who has
// not signed in may do nothing. Signing in is not a write -- a password never crosses the wire --
// so the cast signs in through the example's own sign-in page (`signIn`), and the stories start
// from there. Bo has asked for a week in October (request 1) and Ann for a day in November
// (request 2), both waiting for Mo.

const ask = (starts: string, ends: string): Write => ({ doc: "team", ops: [{ op: "add", path: "/requests/-", value: { starts, ends } }] });
const answer = (id: number, status: "approved" | "declined"): Write => ({ doc: "team", ops: [{ op: "replace", path: `/requests/${id}/status`, value: status }] });
const withdraw = (id: number): Write => ({ doc: "team", ops: [{ op: "remove", path: `/requests/${id}` }] });
const session = (op: PatchOp): Write => ({ doc: "session", ops: [op] });

export const stories: Stories = {
  cast: { ann: [], bo: [], mo: [], visitor: [] },
  signIn: (name) => (name === "visitor" ? undefined : { path: "/login", form: { email: `${name}@leave.example`, password: `${name}-password` } }),
  at: (where) => session({ op: "replace", path: "/page", value: where }),
  stories: [
    // ── asking ──
    story("Ann asks for the first days of December off, and Mo and Bo see it on the team's list", { as: "ann", from: "mine?new", does: ask("2026-12-01", "2026-12-04"), seen: { ann: "mine", mo: "team", bo: "team" } }),
    story("Ann asks for days that end before they begin, and is told so", { as: "ann", from: "mine?new", cannot: ask("2026-12-04", "2026-12-01"), told: "The last day is before the first." }),
    story("Ann asks for a weekend off, and is told it has no working days in it", { as: "ann", from: "mine?new", cannot: ask("2026-10-10", "2026-10-11"), told: "There are no working days in those." }),
    story("Bo takes back his week in October before Mo has answered", { as: "bo", from: "mine?confirm=1", does: withdraw(1), seen: { bo: "mine", mo: "team", ann: "team" } }),

    // ── seeing who is off when ──
    story("Ann asks for days that overlap Bo's week in October, and everyone's calendar marks the clash", { as: "ann", from: "mine?new", does: ask("2026-10-08", "2026-10-12"), seen: { ann: "calendar/2026-10", mo: "calendar/2026-10", bo: "calendar/2026-10" } }),
    story("Mo opens Bo's week from the calendar and approves it, and Bo sees it approved", { as: "mo", from: "calendar/2026-10?request=1", does: answer(1, "approved"), seen: { mo: "calendar/2026-10?request=1", bo: "mine", ann: "team" } }),

    // ── answering ──
    story("Mo approves Bo's week in October, and Bo sees it approved", { as: "mo", from: "team?request=1", does: answer(1, "approved"), seen: { mo: "team?request=1", bo: "mine", ann: "team" } }),
    story("Mo declines Ann's day in November, and Ann sees it declined", { as: "mo", from: "team?request=2", does: answer(2, "declined"), seen: { mo: "team?request=2", ann: "mine", bo: "team" } }),

    // ── what nobody may do ──
    story("Ann cannot approve her own day off", { as: "ann", from: "mine?request=2", cannot: answer(2, "approved") }),
    story("Only a manager answers: Ann cannot approve Bo's week", { as: "ann", from: "team?request=1", cannot: answer(1, "approved") }),
    story("Ann cannot take back Bo's request", { as: "ann", cannot: withdraw(1) }),
    story("A visitor who has not signed in cannot ask for leave", { as: "visitor", cannot: ask("2026-12-01", "2026-12-04") }),
    story("Ann cannot make herself a manager", { as: "ann", cannot: { doc: "team", ops: [{ op: "replace", path: "/people/1/role", value: "manager" }] } }),
    story("Ann cannot become Mo over the wire", { as: "ann", cannot: session({ op: "replace", path: "/person_id", value: "3" }) }),

    // ── and going ──
    story("Ann signs out, and her page asks her to sign in", { as: "ann", does: session({ op: "remove", path: "/person_id" }), seen: ["ann"] }),
  ],
};

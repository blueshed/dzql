import { describe, expect, test } from "bun:test";
import { checkAgreement, markAgreement, numbered, told, uncited, type Story } from "./agreements";

const set = (doc: string, path: string, value: unknown) => ({ doc, ops: [{ op: "replace", path, value }] });
const add = (doc: string, path: string) => ({ doc, ops: [{ op: "add", path, value: {} }] });

// A small hosting: the authority invites, the venue answers.
const stories: Story[] = [
  { name: "invites", as: "authority", does: add("series", "/venues/-"), seen: { authority: "series/1", venueOwner: "venue/1 @ drawer=x" } },
  { name: "accepts", as: "venueOwner", does: set("venue", "/hosting/1/status", "accepted"), seen: { venueOwner: "venue/1", authority: "series/1" } },
  { name: "declines, telling nobody", as: "venueOwner", does: set("venue", "/hosting/1/status", "declined"), seen: { venueOwner: "venue/1" } },
  { name: "cannot accept its own", as: "authority", cannot: set("series", "/venues/1/status", "accepted") },
  { name: "invites, telling nobody", as: "authority", does: add("series", "/venues/-"), seen: ["authority"] },
  { name: "renames", as: "authority", does: set("series", "/name", "x") },
];
const hosting = (...lines: string[]) => ["@startuml", ...lines, "@enduml"].join("\n");

describe("checkAgreement", () => {
  test("a machine whose every move reaches those it concerns agrees", () => {
    const r = checkAgreement(hosting("[*] --> invited : authority invites (1)", "invited --> accepted : venueOwner accepts (2)", "invited -[dotted]-> accepted : authority cannot (4)", "accepted --> [*]"), stories);
    expect(r.drift).toEqual([]);
    expect([...r.cited]).toEqual([1, 2, 4]);
  });

  test("a turn nobody is told of is blind, and an answer the asker is not told of is unseen", () => {
    const r = checkAgreement(hosting("[*] --> invited : authority invites (5)", "invited --> declined : venueOwner declines (3)", "declined --> [*]"), stories);
    expect(r.drift).toEqual(["[*] → invited: venueOwner is not told, and it is their move (5)", "invited → declined: authority is not told, and they were waiting on it (3)"]);
  });

  test("an arrow must cite a story of its role that does what it draws", () => {
    const r = checkAgreement(hosting(
      "[*] --> invited : authority invites (99)",
      "[*] --> invited : venueOwner invites (1)",
      "[*] --> proposed : authority renames (6)",
      "invited --> declined : venueOwner accepts (2)",
      "invited -[dotted]-> accepted : venueOwner cannot (2)",
      "invited --> accepted : authority refuses (4)",
      "declined --> [*]",
    ), stories);
    expect(r.drift).toEqual([
      "[*] → invited: (99) is not a story",
      "[*] → invited: (1) is told as authority, not venueOwner",
      "[*] → proposed: (6) does not make one",
      "invited → declined: (2) sets accepted, not declined",
      "invited → accepted: (2) is a move, not a refusal",
      "invited → accepted: (4) is a refusal, drawn as a move",
      "proposed: no move out of it, and it is not drawn as an end",
      "accepted: no move out of it, and it is not drawn as an end",
    ]);
  });

  test("an alias stands for its value", () => {
    const r = checkAgreement(hosting('state "accepted" as yes', "[*] --> invited : authority invites (1)", "invited --> yes : venueOwner accepts (2)", "yes --> [*]"), stories);
    expect(r.drift).toEqual([]);
  });

  test("a party who joins later is asked after only from the states that follow its joining", () => {
    // The worker is not told when the deployment is made, joins when put on it, and must hear of what follows.
    const s: Story[] = [
      { name: "drops", as: "contractor", does: add("projects", "/deployments/-"), seen: ["contractor", "venueOwner"] },
      { name: "accepts", as: "venueOwner", does: set("venue", "/deployments/1/status", "accepted"), seen: ["venueOwner", "contractor"] },
      { name: "puts a worker on it", as: "contractor", does: add("projects", "/assignments/-"), seen: ["contractor", "worker"] },
      { name: "builds", as: "worker", does: set("worker", "/deployment/status", "built"), seen: ["worker", "contractor", "venueOwner"] },
      { name: "takes back", as: "worker", does: set("worker", "/deployment/status", "accepted"), seen: ["worker", "contractor"] },
      { name: "cancels, telling nobody", as: "contractor", does: set("projects", "/deployments/1/status", "cancelled"), seen: ["contractor"] },
    ];
    const r = checkAgreement(hosting(
      "[*] --> proposed : contractor drops (1)",
      "proposed --> accepted : venueOwner accepts (2)",
      "accepted --> accepted : contractor puts a worker on it (3)",
      "accepted --> built : worker builds (4)",
      "built --> accepted : worker takes back (5)",
      "built --> cancelled : contractor cancels (6)",
      "cancelled --> [*]",
    ), s);
    expect(r.drift).toEqual(["built → cancelled: worker is not told, and they were waiting on it (6)"]);
  });
});

test("told: each role with the page it has open, home for none", () => {
  expect([...told(stories[0]!)]).toEqual([["authority", "series/1"], ["venueOwner", "venue/1"]]);
  expect([...told(stories[4]!)]).toEqual([["authority", "home"]]);
  expect([...told(stories[5]!)]).toEqual([]);
});

test("uncited: the status moves on no diagram; numbered: every story by its number", () => {
  expect(uncited(stories, new Set([2, 4]))).toEqual(["(3) venueOwner: declines, telling nobody"]);
  expect(numbered(stories.slice(2, 4))).toBe("(1) venueOwner: declines, telling nobody\n(2) authority cannot: cannot accept its own");
});

test("markAgreement draws who is told, the failures in red, the refusals grey, and each state's turn", () => {
  const drawn = markAgreement(hosting(
    "[*] --> invited : authority invites (1)",
    "invited --> declined : venueOwner declines (3)",
    "invited -[dotted]-> accepted : authority cannot (4)",
    "invited --> accepted : venueOwner accepts (2)",
    "accepted --> [*]",
  ), "hosting", stories);
  expect(drawn).toContain("[*] --> invited : [[#hosting{invites} authority invites (1)]]\\n<size:10><color:#555555>told: venueOwner @ venue/1</color></size>");
  expect(drawn).toContain("invited -[#c0392b,bold]-> declined : ");
  expect(drawn).toContain("\\n<color:#c0392b>⚠ authority is not told, and they were waiting on it (3)</color>");
  expect(drawn).toContain("invited -[#999999,dotted]-> accepted : <color:#888888>[[#hosting{cannot accept its own} authority cannot (4)]] ✗</color>");
  expect(drawn).toContain("invited : <size:11>move: venueOwner</size>");
  expect(drawn).toContain("accepted : <size:11><color:#888888>ends: to go again, make a new one</color></size>");
  expect(drawn).toContain("declined : <size:11><color:#c0392b>⚠ no move, and not an end</color></size>");
});

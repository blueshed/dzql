import { describe, expect, test } from "bun:test";
import { example } from "../examples/chat";
import { stories } from "../examples/chat/stories";
import { print, run } from "./harness";

// The harness against chat's own stories: one outcome per story, named as the story is, and the
// cast's setup shared by all. What each story finds is the example's business (a failing story is
// a finding, not a broken harness); this checks the harness runs every story and reports honestly.
describe("stories harness", () => {
  test("runs every story and reports by name", async () => {
    const report = await run(example, stories);
    expect(report.outcomes.map((o) => o.name)).toEqual(stories.stories.map((s) => s.name));
    expect(report.passed + report.failed).toBe(stories.stories.length);
    const seen = report.outcomes.find((o) => o.name.startsWith("Ada says hello"))!;
    expect(seen.failures.filter((f) => f.includes("did not see") || f.includes("noticed"))).toEqual([]);
    const refused = report.outcomes.find((o) => o.name.startsWith("Nobody can take"))!;
    expect(refused.failures).toEqual([]);
    print(report);
  }, 30000);

  test("a story by nobody in the cast, or seen by nobody who could, is a failure, not a crash", async () => {
    process.env.STORY_DIFF = "1"; // the excerpt under a failure is for the builder; make sure it prints
    const report = await run(example, {
      cast: stories.cast,
      stories: [
        { name: "a ghost speaks", as: "ghost", does: { doc: "room", ops: [] }, seen: {} },
        { name: "Ada says hello and Eve, who is nowhere, sees it", as: "ada", does: { doc: "room", ops: [{ op: "add", path: "/transcript/-", value: "hi" }] }, seen: { eve: "" }, unseen: ["cy"] },
      ],
    });
    delete process.env.STORY_DIFF;
    expect(report.failed).toBe(2);
    expect(report.outcomes[0]!.failures[0]).toContain("ghost");
    expect(report.outcomes[1]!.failures).toContain('eve did not see it on ""');
  }, 30000);
});

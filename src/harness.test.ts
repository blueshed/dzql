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

  test("a story by nobody in the cast is a failure, not a crash", async () => {
    const report = await run(example, { cast: stories.cast, stories: [{ name: "a ghost speaks", as: "ghost", does: { doc: "room", ops: [] }, seen: {} }] });
    expect(report.failed).toBe(1);
    expect(report.outcomes[0]!.failures[0]).toContain("ghost");
  }, 30000);
});

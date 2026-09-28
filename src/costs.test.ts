import { expect, test } from "bun:test";

// Every number the README quotes is a run's (src/costs.ts): what one write sends everyone else,
// the client's size, the stories. A change that moves one fails here until `bun run costs` writes
// it in. The run is a process of its own, as each example's measure is: a process serves one example.

/** `bun run costs --check`, with these settings besides the test's own: what it says, and how it ends. */
async function check(settings: Record<string, string> = {}): Promise<{ said: string; code: number }> {
  const run = Bun.spawn(["bun", "src/costs.ts", "--check"], { cwd: `${import.meta.dir}/..`, env: { ...process.env, DB_PATH: ":memory:", TICK_MS: "0", ...settings }, stdout: "pipe", stderr: "pipe" });
  const [said, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
  return { said: code === 0 ? said : said + err, code };
}

test("every number the README quotes is what a run measures", async () => {
  expect(await check()).toEqual({ said: "", code: 0 }); // or: what the README says, and what the run found
}, 60_000);

test("a run says the same whatever is set: REVEAL, which names the wedding's photo, changes nothing", async () => {
  expect(await check({ REVEAL: "1" })).toEqual({ said: "", code: 0 });
}, 60_000);

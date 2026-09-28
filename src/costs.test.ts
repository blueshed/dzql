import { expect, test } from "bun:test";

// Every number the README quotes is a run's (src/costs.ts): what one write sends everyone else,
// the client's size, the stories. A change that moves one fails here until `bun run costs` writes
// it in. The run is a process of its own, as each example's measure is: a process serves one example.
test("every number the README quotes is what a run measures", async () => {
  const run = Bun.spawn(["bun", "src/costs.ts", "--check"], { cwd: `${import.meta.dir}/..`, env: { ...process.env, DB_PATH: ":memory:", TICK_MS: "0" }, stdout: "pipe", stderr: "pipe" });
  const [said, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
  expect(code === 0 ? said : said + err).toBe(""); // or: what the README says, and what the run found
  expect(code).toBe(0);
}, 60_000);

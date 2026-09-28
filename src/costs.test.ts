import { afterAll, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { costs, differing, gzipped, item, measure, received, rewritten, said, size, type Run } from "./costs";

// Every number the README quotes is a run's (src/costs.ts): what one write sends everyone else,
// the client's size, the stories. A change that moves one fails here until `bun run costs` writes
// it in. The run is taken here in this process, where coverage sees it, and once more as the
// script `bun run costs` is, a process of its own; each example's measure is one of its own
// either way, as a process serves one example. Then each piece: the words, the comparison, the
// writing, and what a run that goes wrong says.

const dir = mkdtempSync(join(tmpdir(), "eta-costs-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** What `costs()` says, line by line, and how it ends. */
async function run(argv: string[], options: Parameters<typeof costs>[1] = {}): Promise<{ code: number; said: string[] }> {
  const lines: string[] = [];
  const code = await costs(argv, { ...options, say: (line) => lines.push(line) });
  return { code, said: lines };
}

test("every number the README quotes is what a run measures", async () => {
  expect(await run(["--check"])).toEqual({ code: 0, said: [] }); // or: what the README says, and what the run found
}, 60_000);

/** `bun run costs --check`, with these settings besides the test's own: what it says, and how it ends. */
async function check(settings: Record<string, string> = {}): Promise<{ said: string; code: number }> {
  const proc = Bun.spawn(["bun", "src/costs.ts", "--check"], { cwd: `${import.meta.dir}/..`, env: { ...process.env, DB_PATH: ":memory:", TICK_MS: "0", ...settings }, stdout: "pipe", stderr: "pipe" });
  const [said, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { said: code === 0 ? said : said + err, code };
}

test("run as the script, a run says the same whatever is set: REVEAL, which names the wedding's photo, changes nothing", async () => {
  expect(await check({ REVEAL: "1" })).toEqual({ said: "", code: 0 });
}, 60_000);

test("what one page was sent, in words: its sizes, the patches and the HTML; a message of another kind is not described but refused", () => {
  expect([size(1023), size(1024), size(1280)]).toEqual(["1023\u00a0B", "1.0\u00a0KB", "1.3\u00a0KB"]);
  const words = (heard: { type: string; bytes: number }[]) => received({ who: "each viewer", heard }).replaceAll("\u00a0", " ");
  expect(words([{ type: "patch", bytes: 345 }, { type: "render", bytes: 844 }])).toBe("1.2 KB to each viewer (a 345 B patch and 844 B of HTML)");
  expect(words([{ type: "patch", bytes: 200 }])).toBe("200 B to each viewer (one patch and no HTML)");
  expect(words([{ type: "patch", bytes: 200 }, { type: "patch", bytes: 100 }, { type: "patch", bytes: 64 }])).toBe("364 B to each viewer (patches of 200 B, 100 B and 64 B, and no HTML)");
  expect(words([{ type: "render", bytes: 900 }])).toBe("900 B to each viewer (no patch and 900 B of HTML)");
  expect(() => words([{ type: "patch", bytes: 1 }, { type: "welcome", bytes: 9 }])).toThrow("each viewer was sent a welcome, which the README does not describe");
});

test("a list item is wrapped as the README is: a line is at most 100 wide, and the next goes on under the first word", () => {
  const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const lines = item(text).split("\n");
  expect(lines.length).toBeGreaterThan(2);
  expect(lines.every((line) => line.length <= 100)).toBe(true);
  expect(lines[0]).toStartWith("- word0 ");
  expect(lines.slice(1).every((line) => line.startsWith("  word"))).toBe(true);
  expect(lines.join(" ").replace(/^- /, "").replace(/\s+/g, " ")).toBe(text);
});

test("the README says what a run does word for word, however its lines fall; a built bundle's size stands within 3%", () => {
  const now: Run = { found: new Map([["client", "3.5 KB"], ["stories", "11 in chat and 50 in wedding"], ["writes", "- **Chat**: 1.2 KB"]]), built: new Map([["client", [3584]]]) };
  const says = (client: string, extra: [string, string][] = []) => new Map([["client", client], ["stories", "11 in chat\n  and 50 in wedding"], ["writes", "- **Chat**: 1.2 KB"], ...extra]);
  expect(differing(says("3.5 KB"), now)).toEqual([]);
  expect(differing(says("3.6 KB"), now)).toEqual([]); // 3686 B, within 3% of 3584
  expect(differing(says("3.7 KB"), now)).toEqual(["client"]); // 3789 B is not
  expect(differing(says("about 3.5 KB"), now)).toEqual(["client"]); // the words around a size are held to the word
  expect(differing(says("3.5 KB", [["gone", "1"]]), now)).toEqual(["gone"]); // a mark no run measures
  expect(differing(new Map([["client", "3.5 KB"], ["stories", "11 in chat"]]), now)).toEqual(["stories", "writes"]); // a mismeasured story count is held to the word; a number with no mark differs too
});

test("writing: each mark that differs is written as the run found it, and nothing else; a number with no mark to go in is an error", () => {
  const now: Run = { found: new Map([["client", "3.5 KB"], ["stories", "11 in chat"]]), built: new Map() };
  const readme = "The client is <!-- measured:client -->3.0 KB<!-- /measured -->; the stories <!-- measured:stories -->11 in chat<!-- /measured -->.";
  expect([...said(readme)]).toEqual([["client", "3.0 KB"], ["stories", "11 in chat"]]);
  expect(rewritten(readme, now, ["client"])).toBe("The client is <!-- measured:client -->3.5 KB<!-- /measured -->; the stories <!-- measured:stories -->11 in chat<!-- /measured -->.");
  expect(rewritten(readme, now, [])).toBe(readme);
  expect(() => rewritten("The client is <!-- measured:client -->3.0 KB<!-- /measured -->.", now, ["client", "stories"])).toThrow("README.md has no mark for stories");
});

test("`bun run costs` writes what a run finds into the README, and says so; `--check` writes nothing, says each difference, and fails", async () => {
  const readme = join(dir, "README.md");
  const now = async (): Promise<Run> => ({ found: new Map([["client", "3.5 KB"], ["stories", "11 in chat"]]), built: new Map([["client", [3584]]]) });
  const stale = "The client is <!-- measured:client -->3.0 KB<!-- /measured -->; the stories <!-- measured:stories -->11 in chat<!-- /measured -->.";
  await Bun.write(readme, stale);

  expect(await run(["--check"], { readme, run: now })).toEqual({
    code: 1,
    said: ["README.md's client:\n  says:  3.0 KB\n  a run: 3.5 KB", "\n`bun run costs` writes what a run says into the README."],
  });
  expect(await Bun.file(readme).text()).toBe(stale);

  expect(await run([], { readme, run: now })).toEqual({ code: 0, said: ["README.md: client written from a run"] });
  expect(await Bun.file(readme).text()).toBe(stale.replace("3.0 KB", "3.5 KB"));
  expect(await run([], { readme, run: now })).toEqual({ code: 0, said: ["README.md already says what a run does"] });
  expect(await run(["--check"], { readme, run: now })).toEqual({ code: 0, said: [] });

  // a number the README has no mark for: the check says so, and writing it is refused rather than dropped
  await Bun.write(readme, "The client is <!-- measured:client -->3.5 KB<!-- /measured -->, and <!-- measured:gone -->1<!-- /measured -->.");
  const { code, said: lines } = await run(["--check"], { readme, run: now });
  expect(code).toBe(1);
  expect(lines).toContain("README.md's stories:\n  says:  (nothing: it has no mark)\n  a run: 11 in chat");
  expect(lines).toContain("README.md's gone:\n  says:  1\n  a run: (nothing: no run measures it)");
  expect(run([], { readme, run: now })).rejects.toThrow("README.md has no mark for stories: put <!-- measured:<name> --><!-- /measured --> where it goes");
});

test("a measure runs in a process of its own: none of the caller's settings, its clock standing still, and its last line is what it says", async () => {
  const script = join(dir, "measure.ts");
  await Bun.write(script, `console.log("setting up");\nconsole.log(JSON.stringify({ name: "Test", what: new Date().toISOString(), to: [], reveal: process.env.REVEAL ?? null, db: process.env.DB_PATH }));\n`);
  const was = process.env.REVEAL;
  process.env.REVEAL = "1";
  try {
    expect((await measure(script)) as unknown).toEqual({ name: "Test", what: "2026-09-01T12:00:00.000Z", to: [], reveal: null, db: ":memory:" });
  } finally {
    if (was === undefined) delete process.env.REVEAL;
    else process.env.REVEAL = was;
  }
});

test("a run that goes wrong says where: a measure that fails, with what it said; a bundle that does not build, with why", async () => {
  const script = join(dir, "fails.ts");
  await Bun.write(script, `console.error("no room for the members");\nprocess.exit(3);\n`);
  expect(measure(script)).rejects.toThrow(`${script} failed (3):\nno room for the members`);

  const entry = join(dir, "entry.ts");
  expect(await gzipped(entry, `console.log("a small client");`)).toBeGreaterThan(0);
  expect(gzipped(entry, "export const = ;")).rejects.toThrow("Expected identifier");
});

test("a bundle is measured as production builds it: what a package says only in development is not counted", async () => {
  const entry = join(dir, "production.ts");
  const client = `console.log("a small client");`;
  const warning = `if (process.env.NODE_ENV !== "production") console.warn("${"said only in development; ".repeat(20)}");`;
  expect(await gzipped(entry, warning + client)).toBe(await gzipped(entry, client));
});

test("a measure's clock stands still, on a day before the wedding's", async () => {
  try {
    const { STILL } = await import("./costs-clock");
    const at = Date.now();
    await Bun.sleep(5);
    expect([at, Date.now()]).toEqual([STILL.getTime(), STILL.getTime()]);
    expect(STILL < new Date("2027-04-02")).toBe(true); // the seed's wedding day: its photo still has no names
  } finally {
    setSystemTime();
  }
});

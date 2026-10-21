// A Shed run: the app made from the checkout (--local), installed as it ships, then each stage a
// fresh session, committed after it by this driver; per stage the minutes, the tests, and the lines
// of src/ and tests/. `bun run.ts <app> --installed-only` stops after the install (to check it).
import { $ } from "bun";
import { join, resolve } from "node:path";
import { besides, linksInto, packer } from "../../../../../../scripts/packed";
const app = resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? `${process.env.HOME}/Workshop/shed`); // made with create-blueshed --local
const S = import.meta.dir;

// What ships, never the checkout: --local names the checkout's folders, and a session follows
// node_modules' links into the repository (run 6, finding 8). The app's package.json names packed
// tarballs instead (kept beside the app), installed again, before stage 1.
packer(besides(app)).ship(app);
const linked = linksInto(join(app, "node_modules"));
if (linked.length) throw new Error(`still linked into the checkout:\n${linked.join("\n")}`);
await $`git add -A && git commit -q -m ${"Installed as it ships: railroad, delta and dzql from packed tarballs"}`.cwd(app).nothrow();
if (process.argv.includes("--installed-only")) process.exit(0);
const logs = process.env.SHED_LOGS ?? (await import("node:os")).tmpdir(); // each stage's log and prompt, and score.json
const titles = ["the shed's list", "borrowing", "the shed knows what is out", "kits and due dates", "two sheds, and each member's own"];
const lines = async (dir: string) => {
  const files = [...new Bun.Glob(`${dir}/**/*.{ts,tsx}`).scanSync(app)].filter((f) => !f.includes("node_modules"));
  let n = 0;
  for (const f of files) n += (await Bun.file(`${app}/${f}`).text()).split("\n").length - 1;
  return n;
};
const score: any[] = [];
for (let n = 1; n <= 5; n++) {
  const t = performance.now();
  await $`bun ${S}/stage.ts ${app} ${n} ${logs}/stage${n}.log`;
  const minutes = +((performance.now() - t) / 60000).toFixed(1);
  const test = await $`bun test`.cwd(app).nothrow().quiet();
  const out = test.stdout.toString() + test.stderr.toString();
  const pass = Number(/^ *(\d+) pass/m.exec(out)?.[1] ?? 0), fail = Number(/^ *(\d+) fail/m.exec(out)?.[1] ?? 0);
  const all = /All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/.exec(out);
  const check = (await $`bun check`.cwd(app).nothrow().quiet()).exitCode === 0;
  await $`git add -A && git commit -q -m ${`Stage ${n}: ${titles[n - 1]}`}`.cwd(app).nothrow();
  const commit = (await $`git rev-parse --short HEAD`.cwd(app).text()).trim();
  score.push({ stage: n, commit, minutes, pass, fail, coverage: all ? [all[1], all[2]] : null, check, src: await lines("src"), tests: await lines("tests"), exit: test.exitCode });
  await Bun.write(`${logs}/score.json`, JSON.stringify(score, null, 2));
  console.log(JSON.stringify(score.at(-1)));
}

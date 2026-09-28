// The README's numbers, measured (todo n7): a number in a README goes stale, and a run does not.
// The README marks each number it quotes (`<!-- measured:<name> -->…<!-- /measured -->`), and this
// measures them all: what one write sends everyone else, by each example's own script
// (`examples/<name>/scripts/measure-render-cost.ts --json`, each in a process of its own, from an
// empty database: a process serves one example); the kernel's client and railroad, built and
// gzipped as a browser is sent them; and each example's stories, counted. `bun run costs` writes
// what it finds into the README; `--check` (src/costs.test.ts, so `bun test`) says where the
// README differs, and fails.

/** What an example's measure script says with `--json`: one write, and what each other page was sent. */
export type Measured = {
  /** The example, as the README names it: "Chat". */
  name: string;
  /** The write, in the example's words: "one message in a room of 100 messages and 5 members". */
  what: string;
  /** Who was sent what: every message, by its type and size. */
  to: { who: string; heard: { type: string; bytes: number }[] }[];
  /** The same change sent some other way, for scale. */
  against?: { what: string; bytes: number };
};

const root = `${import.meta.dir}/..`;
const README = `${root}/README.md`;
const MARK = /<!-- measured:([\w-]+) -->([\s\S]*?)<!-- \/measured -->/g;
const WIDTH = 100;

// a size is never broken across a line (a no-break space, until it is written)
const size = (bytes: number): string => (bytes < 1024 ? `${bytes}\u00a0B` : `${(bytes / 1024).toFixed(1)}\u00a0KB`);
const sum = (heard: { bytes: number }[]): number => heard.reduce((n, h) => n + h.bytes, 0);
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const many = (n: number, one: string, more: string): string => `${WORDS[n] ?? n} ${n === 1 ? one : more}`;
const and = (items: string[]): string => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join("; ")}; and ${items.at(-1)}`);

/** What one page was sent, in words: "<size> to each other member (a <size> patch and <size> of HTML)". */
function received({ who, heard }: Measured["to"][number]): string {
  const other = heard.find((h) => h.type !== "patch" && h.type !== "render");
  if (other) throw new Error(`${who} was sent a ${other.type}, which the README does not describe`);
  const patches = heard.filter((h) => h.type === "patch");
  const html = heard.filter((h) => h.type === "render");
  if (html.length === 0) return `${size(sum(heard))} to ${who} (${many(patches.length, "patch", "patches")} and no HTML)`;
  const said = patches.length === 1 ? `a ${size(sum(patches))} patch` : `${many(patches.length, "patch", "patches")} of ${size(sum(patches))}`;
  return `${size(sum(heard))} to ${who} (${said} and ${size(sum(html))} of HTML)`;
}

/** A list item, wrapped as the README is. */
function item(text: string): string {
  const lines: string[] = [];
  let line = "-";
  for (const word of text.split(" ")) {
    if (line.length + 1 + word.length > WIDTH) {
      lines.push(line);
      line = " ";
    }
    line += ` ${word}`;
  }
  return [...lines, line].join("\n");
}

/** One example's measure script, run in a process of its own from an empty database. */
async function measure(script: string): Promise<Measured> {
  const run = Bun.spawn(["bun", script, "--json"], { cwd: root, env: { ...process.env, DB_PATH: ":memory:", TICK_MS: "0" }, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
  if (code !== 0) throw new Error(`${script} failed (${code}):\n${err}`);
  return JSON.parse(out.trim().split("\n").at(-1)!) as Measured;
}

/** A bundle as a browser is sent it: minified, then gzipped. */
async function gzipped(entry: string, source?: string): Promise<number> {
  const built = await Bun.build({ entrypoints: [entry], minify: true, target: "browser", files: source === undefined ? undefined : { [entry]: source } });
  if (!built.success) throw new Error(built.logs.join("\n"));
  return Bun.gzipSync(await built.outputs[0]!.text()).length;
}

/** Every number the README quotes, by its mark. */
async function measured(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const dirs = [...new Bun.Glob("examples/*/").scanSync({ cwd: root, onlyFiles: false })].map((d) => d.replace(/\/$/, "")).sort();

  const scripts = [...new Bun.Glob("examples/*/scripts/measure-render-cost.ts").scanSync({ cwd: root })].sort();
  const writes = await Promise.all(scripts.map(measure));
  const lines = writes.map((m) => item(`**${m.name}**, ${m.what}: ${and(m.to.map(received))}.${m.against ? ` ${m.against.what[0]!.toUpperCase()}${m.against.what.slice(1)} would be ${size(m.against.bytes)}.` : ""}`));
  found.set("writes", `\n${lines.join("\n")}\n`);

  found.set("client", size(await gzipped(`${root}/src/client/app.ts`)));
  const railroad = (names: string) => gzipped(`${root}/src/railroad-measured.ts`, `import { ${names} } from "@blueshed/railroad/jsx"; import { signal } from "@blueshed/railroad/signals"; Object.assign(globalThis, { signal, ${names} });`);
  found.set("railroad", `${size(await railroad("mount"))} gzipped for \`signal\` and \`mount\`, ${size(await railroad("mount, list"))} with \`list\``);

  // the stories `bun run stories:all` runs: an example's, once it has an app
  const counts: string[] = [];
  for (const dir of dirs) {
    if (!(await Bun.file(`${root}/${dir}/stories.ts`).exists()) || !(await Bun.file(`${root}/${dir}/index.ts`).exists())) continue;
    const { stories } = (await import(`${root}/${dir}/stories.ts`)) as { stories: { stories: unknown[] } };
    counts.push(`${stories.stories.length} in ${dir.slice("examples/".length)}`);
  }
  found.set("stories", counts.length < 2 ? counts.join("") : `${counts.slice(0, -1).join(", ")} and ${counts.at(-1)}`);
  return new Map([...found].map(([name, text]) => [name, text.replaceAll("\u00a0", " ")]));
}

const readme = await Bun.file(README).text();
const said = new Map([...readme.matchAll(MARK)].map((m) => [m[1]!, m[2]!]));
const now = await measured();
// the words, not how the lines fall: prose around a mark is wrapped by hand
const words = (text: string | undefined): string | undefined => text?.replace(/\s+/g, " ").trim();
const differs = [...new Set([...said.keys(), ...now.keys()])].filter((name) => words(said.get(name)) !== words(now.get(name)));

if (process.argv.includes("--check")) {
  for (const name of differs) console.log(`README.md's ${name}:\n  says:  ${words(said.get(name)) ?? "(nothing: it has no mark)"}\n  a run: ${words(now.get(name)) ?? "(nothing: no run measures it)"}`);
  if (differs.length > 0) {
    console.log("\n`bun run costs` writes what a run says into the README.");
    process.exit(1);
  }
} else {
  const missing = [...now.keys()].filter((name) => !said.has(name));
  if (missing.length > 0) throw new Error(`README.md has no mark for ${missing.join(", ")}: put <!-- measured:<name> --><!-- /measured --> where it goes`);
  await Bun.write(README, readme.replace(MARK, (whole, name: string) => (differs.includes(name) && now.has(name) ? `<!-- measured:${name} -->${now.get(name)}<!-- /measured -->` : whole)));
  console.log(differs.length ? `README.md: ${differs.join(", ")} written from a run` : "README.md already says what a run does");
}

// The README's numbers, measured (todo n7): a number in a README goes stale, and a run does not.
// The README marks each number it quotes (`<!-- measured:<name> -->…<!-- /measured -->`), and this
// measures them all: what one write sends everyone else as it crosses the wire, compressed (a
// `tap` in front of the server sees it), by each example's own script
// (`examples/<name>/scripts/measure-render-cost.ts --json`, each in a process of its own, from an
// empty database, with no settings but its own, no .env, and a clock that stands still
// (src/costs-clock.ts): a process serves one example, and a run says the same whatever the day or
// the settings); the kernel's client and railroad, built and gzipped as a browser is sent them in
// production; and each example's stories, counted. `bun run costs` writes
// what it finds into the README; `--check` (src/costs.test.ts, so `bun test`) says where the
// README differs, and fails. Two kinds of size are not held to the byte: a bundle's, which a
// minifier moves a few bytes at a time, and a compressed message's, which moves a byte or two with
// the random ids it carries (a room's, a message's). The README's figure for one stands while it
// is within 3% of a run's (`WITHIN`), beyond what its rounding hides, so it does not flip back and
// forth. Run as a script, it is `costs()`; imported, nothing runs, so its test takes each piece in
// hand in the test's own process, where coverage sees it, and runs the whole as a script besides.

import { connect, createServer, type AddressInfo } from "node:net";

/** One message a page was sent: its type, its size, and its size as it crossed the wire (compressed, when it was). */
export type Heard = { type: string; bytes: number; sent: number };

/** What an example's measure script says with `--json`: one write, and what each other page was sent. */
export type Measured = {
  /** The example, as the README names it: "Chat". */
  name: string;
  /** The write, in the example's words: "one message in a room of 100 messages and 5 members". */
  what: string;
  /** Who was sent what: every message, by its type and its sizes. */
  to: { who: string; heard: Heard[] }[];
  /** The same change sent some other way, for scale. */
  against?: { what: string; bytes: number };
};

/** A run's findings: each mark's words; and of a mark whose sizes move a little from run to run (`near`), each to the byte, in the order its words say them. */
export type Run = { found: Map<string, string>; near: Map<string, number[]> };

const root = `${import.meta.dir}/..`;
const README = `${root}/README.md`;
const MARK = /<!-- measured:([\w-]+) -->([\s\S]*?)<!-- \/measured -->/g;
const WIDTH = 100;
/** How far a size that moves a little from run to run may be from what the README says of it, as a share of the run's. */
const WITHIN = 0.03;
const SIZE = /(\d+(?:\.\d+)?) (K?B)\b/g;

// a size is never broken across a line (a no-break space, until it is written)
export const size = (bytes: number): string => (bytes < 1024 ? `${bytes}\u00a0B` : `${(bytes / 1024).toFixed(1)}\u00a0KB`);
export const sum = (heard: Heard[], of: "bytes" | "sent" = "sent"): number => heard.reduce((n, h) => n + h[of], 0);
const and = (items: string[]): string => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join("; ")}; and ${items.at(-1)}`);

/**
 * What one page was sent, in words, as it crossed the wire: "<size>, compressed from <size>, to
 * each other member (a <size> patch and <size> of HTML)", or with several patches each one's size:
 * "(patches of <size> and <size>, and no HTML)". Each size is said through `say`, in the order the
 * words say them.
 */
export function received({ who, heard }: Measured["to"][number], say: (bytes: number) => string = size): string {
  const other = heard.find((h) => h.type !== "patch" && h.type !== "render");
  if (other) throw new Error(`${who} was sent a ${other.type}, which the README does not describe`);
  const each = heard.filter((h) => h.type === "patch").map((h) => h.sent);
  const html = heard.filter((h) => h.type === "render");
  const total = `${say(sum(heard))}, compressed from ${say(sum(heard, "bytes"))}, to ${who}`;
  const patches =
    each.length === 0 ? "no patch" : each.length === 1 ? (html.length ? `a ${say(each[0]!)} patch` : "one patch") : `patches of ${each.slice(0, -1).map((n) => say(n)).join(", ")} and ${say(each.at(-1)!)},`;
  return `${total} (${patches} and ${html.length ? `${say(sum(html))} of HTML` : "no HTML"})`;
}

/** A list item, wrapped as the README is. */
export function item(text: string): string {
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

/**
 * One example's measure script, run in a process of its own from an empty database. It is given no
 * setting of the caller's (`REVEAL` would put the names on the wedding's photo) and reads no .env,
 * and its clock is stopped on a day before the wedding.
 */
export async function measure(script: string): Promise<Measured> {
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DB_PATH: ":memory:", TICK_MS: "0" };
  const run = Bun.spawn(["bun", "--no-env-file", "--preload", `${import.meta.dir}/costs-clock.ts`, script, "--json"], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
  if (code !== 0) throw new Error(`${script} failed (${code}):\n${err}`);
  return JSON.parse(out.trim().split("\n").at(-1)!) as Measured;
}

/**
 * A way in to the server on `port` for a measure, or the stories' cast (src/harness.ts), which sees
 * what crosses the wire: a socket opened to `url` is passed on to the server as it is, and the size
 * of each text frame the server sends back -- its payload, compressed when it was -- is kept under
 * the session its upgrade's cookie names. `heard(sessionId, raws)` sizes the last messages a
 * session heard before one more (the answer that ended them, as a measure's `heard` asks, and the
 * stories' `settle`): each one's type, size, and size as sent.
 */
export async function tap(port: number): Promise<{ url: string; heard: (sessionId: string, raws: string[]) => Heard[]; close: () => void }> {
  const frames = new Map<string, number[]>();
  const server = createServer((client) => {
    const sent: number[] = [];
    const upstream = connect(port, "127.0.0.1");
    client.pipe(upstream).pipe(client);
    let request = "";
    client.on("data", function upgrade(chunk: Buffer) {
      request += chunk.toString("latin1");
      if (!request.includes("\r\n\r\n")) return;
      frames.set(/session_id=([^;\s]+)/.exec(request)?.[1] ?? "", sent);
      client.off("data", upgrade);
    });
    // what the server sends: its answer to the upgrade, then frames, never masked, however the reads fall
    let left = Buffer.alloc(0);
    let upgraded = false;
    upstream.on("data", (chunk: Buffer) => {
      left = Buffer.concat([left, chunk]);
      if (!upgraded) {
        const end = left.indexOf("\r\n\r\n");
        if (end < 0) return;
        [left, upgraded] = [left.subarray(end + 4), true];
      }
      while (left.length >= 2) {
        const n = left[1]! & 0x7f;
        const at = n === 126 ? 4 : n === 127 ? 10 : 2;
        if (left.length < at) return;
        const length = n === 126 ? left.readUInt16BE(2) : n === 127 ? Number(left.readBigUInt64BE(2)) : n;
        if (left.length < at + length) return;
        if ((left[0]! & 0x0f) === 1) sent.push(length);
        left = left.subarray(at + length);
      }
    });
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const heard = (sessionId: string, raws: string[]): Heard[] => {
    const sent = (frames.get(sessionId) ?? []).slice(0, -1).slice(-raws.length);
    if (sent.length < raws.length) throw new Error(`the wire carried ${sent.length} messages to ${sessionId} before its last, not ${raws.length}`);
    return raws.map((raw, i) => ({ type: JSON.parse(raw).type, bytes: Buffer.byteLength(raw, "utf8"), sent: sent[i]! }));
  };
  return { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`, heard, close: () => server.close() };
}

/**
 * A bundle as a browser is sent it in production: minified, `process.env.NODE_ENV` as production
 * says it (a bundle otherwise takes the builder's own, and keeps what a package says only in
 * development), then gzipped. One that does not build says why.
 */
export async function gzipped(entry: string, source?: string): Promise<number> {
  const files = source === undefined ? undefined : { [entry]: source };
  const built = await Bun.build({ entrypoints: [entry], minify: true, target: "browser", define: { "process.env.NODE_ENV": '"production"' }, files, throw: false });
  if (!built.success) throw new Error(built.logs.join("\n"));
  return Bun.gzipSync(await built.outputs[0]!.text()).length;
}

/** Every number the README quotes, by its mark; and of a mark whose sizes move a little from run to run, each to the byte, in the order its words say them. */
export async function measured(): Promise<Run> {
  const found = new Map<string, string>();
  const near = new Map<string, number[]>();
  const dirs = [...new Bun.Glob("examples/*/").scanSync({ cwd: root, onlyFiles: false })].map((d) => d.replace(/\/$/, "")).sort();

  const scripts = [...new Bun.Glob("examples/*/scripts/measure-render-cost.ts").scanSync({ cwd: root })].sort();
  const writes = await Promise.all(scripts.map(measure));
  const sizes: number[] = [];
  const say = (bytes: number): string => (sizes.push(bytes), size(bytes));
  const lines = writes.map((m) => item(`**${m.name}**, ${m.what}: ${and(m.to.map((to) => received(to, say)))}.${m.against ? ` ${m.against.what[0]!.toUpperCase()}${m.against.what.slice(1)} would be ${say(m.against.bytes)}.` : ""}`));
  found.set("writes", `\n${lines.join("\n")}\n`);
  near.set("writes", sizes);

  const client = await gzipped(`${root}/src/client/app.ts`);
  found.set("client", size(client));
  near.set("client", [client]);
  const railroad = (names: string) => gzipped(`${root}/src/railroad-measured.ts`, `import { ${names} } from "@blueshed/railroad/jsx"; import { signal } from "@blueshed/railroad/signals"; Object.assign(globalThis, { signal, ${names} });`);
  const [mount, list] = [await railroad("mount"), await railroad("mount, list")];
  found.set("railroad", `${size(mount)} gzipped for \`signal\` and \`mount\`, ${size(list)} with \`list\``);
  near.set("railroad", [mount, list]);

  // the stories `bun run stories:all` runs: an example's, once it has an app and a story (the starter has none)
  const counts: string[] = [];
  for (const dir of dirs) {
    if (!(await Bun.file(`${root}/${dir}/stories.ts`).exists()) || !(await Bun.file(`${root}/${dir}/index.ts`).exists())) continue;
    const { stories } = (await import(`${root}/${dir}/stories.ts`)) as { stories: { stories: unknown[] } };
    if (stories.stories.length > 0) counts.push(`${stories.stories.length} in ${dir.slice("examples/".length)}`);
  }
  found.set("stories", counts.length < 2 ? counts.join("") : `${counts.slice(0, -1).join(", ")} and ${counts.at(-1)}`);
  return { found: new Map([...found].map(([name, text]) => [name, text.replaceAll("\u00a0", " ")])), near };
}

/** What a README says, by its marks. */
export const said = (readme: string): Map<string, string> => new Map([...readme.matchAll(MARK)].map((m) => [m[1]!, m[2]!]));

// the words, not how the lines fall: prose around a mark is wrapped by hand
const words = (text: string | undefined): string | undefined => text?.replace(/\s+/g, " ").trim();
const bytesOf = (m: RegExpMatchArray): number => Number(m[1]) * (m[2] === "KB" ? 1024 : 1);
/** How far a size as the README says it may be from the bytes it stands for: a tenth of a KB is rounded to. */
const rounding = (m: RegExpMatchArray): number => (m[2] === "KB" ? 0.05 * 1024 : 0);

/** The marks where a README does not say what a run does: word for word, or of a mark whose sizes move (`near`), each size within `WITHIN` of the run's, and what its rounding hides. */
export function differing(says: Map<string, string>, { found, near }: Run): string[] {
  const agrees = (name: string): boolean => {
    const [was, is, exact] = [words(says.get(name)), words(found.get(name)), near.get(name)];
    if (was === is) return true;
    if (!exact || was === undefined || is === undefined || was.replace(SIZE, "#") !== is.replace(SIZE, "#")) return false;
    return [...was.matchAll(SIZE)].every((m, i) => Math.abs(bytesOf(m) - exact[i]!) <= WITHIN * exact[i]! + rounding(m));
  };
  return [...new Set([...says.keys(), ...found.keys()])].filter((name) => !agrees(name));
}

/** A README with each mark in `differs` written as the run found it, and the rest as they are. A number the run finds with no mark to go in is an error, not dropped. */
export function rewritten(readme: string, { found }: Run, differs: string[]): string {
  const says = said(readme);
  const missing = [...found.keys()].filter((name) => !says.has(name));
  if (missing.length > 0) throw new Error(`README.md has no mark for ${missing.join(", ")}: put <!-- measured:<name> --><!-- /measured --> where it goes`);
  return readme.replace(MARK, (whole, name: string) => (differs.includes(name) && found.has(name) ? `<!-- measured:${name} -->${found.get(name)}<!-- /measured -->` : whole));
}

/**
 * `bun run costs`: writes what a run finds into the README. With `--check` it writes nothing, says
 * each mark the README has otherwise, and answers 1 if there is one; else 0.
 */
export async function costs(argv: string[], { readme = README, run = measured, say = console.log }: { readme?: string; run?: () => Promise<Run>; say?: (line: string) => void } = {}): Promise<number> {
  const text = await Bun.file(readme).text();
  const now = await run();
  const says = said(text);
  const differs = differing(says, now);
  if (argv.includes("--check")) {
    for (const name of differs) say(`README.md's ${name}:\n  says:  ${words(says.get(name)) ?? "(nothing: it has no mark)"}\n  a run: ${words(now.found.get(name)) ?? "(nothing: no run measures it)"}`);
    if (differs.length === 0) return 0;
    say("\n`bun run costs` writes what a run says into the README.");
    return 1;
  }
  await Bun.write(readme, rewritten(text, now, differs));
  say(differs.length ? `README.md: ${differs.join(", ")} written from a run` : "README.md already says what a run does");
  return 0;
}

if (import.meta.main) process.exitCode = await costs(process.argv.slice(2));

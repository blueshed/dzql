#!/usr/bin/env bun

// bun run eta:update [version | path]: brings a project made by `bun create blueshed/eta` to a
// later eta. A project keeps this file as eta/update.ts and runs it from its root.
//
//   bun run eta:update            the latest release of blueshed/eta on GitHub
//   bun run eta:update 0.54.0     that release (its tag, v0.54.0)
//   bun run eta:update ../eta     an eta checkout on this machine, as it stands
//
// A release comes as GitHub's tarball of its tag, unpacked by Bun itself (`Bun.Archive`, which
// reads a .tar.gz whole: no `tar`) into a folder of its own under the system's temp, removed after.
// Then that eta's own create/eta.ts does the rest (`update`): eta/ replaced whole, the root's eta
// scripts and dependencies, `bun install`, the skills, what eta's changelog says changed since,
// what to change first, and the project's gate. Nothing is committed.
//
// A project made before eta/ was (app/, model/, src/) has no eta/update.ts: from its root, run this
// file from a checkout of eta (`bun ../eta/create/update.ts`), or from main on GitHub, saved first.
// It moves the project once.

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = "blueshed/eta";

/** The latest release's tag: GitHub's latest release, or, with none made, the highest version tag. */
async function latest(): Promise<string> {
  const release = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (release.ok) return ((await release.json()) as { tag_name: string }).tag_name;
  const tags = await fetch(`https://api.github.com/repos/${REPO}/tags?per_page=100`);
  if (!tags.ok) throw new Error(`GitHub did not say what eta's releases are (${tags.status} ${tags.statusText})`);
  const versions = ((await tags.json()) as { name: string }[]).map((t) => t.name).filter((n) => /^v\d+\.\d+\.\d+$/.test(n));
  const newest = versions.sort((a, b) => Bun.semver.order(a.slice(1), b.slice(1))).at(-1);
  if (!newest) throw new Error(`${REPO} has no release tags`);
  return newest;
}

/** A release's tarball, unpacked into `into`: the eta checkout it holds. */
async function download(tag: string, into: string): Promise<string> {
  const res = await fetch(`https://codeload.github.com/${REPO}/tar.gz/refs/tags/${tag}`);
  if (!res.ok) throw new Error(`no eta ${tag} on GitHub (${res.status} ${res.statusText})`);
  await new Bun.Archive(await res.bytes()).extract(into);
  const [top] = readdirSync(into);
  return join(into, top!);
}

const arg = process.argv[2];
const root = process.cwd();
let scratch: string | undefined;
let ok = false;
try {
  let checkout: string;
  let label = arg ?? "";
  if (arg && (arg.startsWith(".") || arg.startsWith("/") || existsSync(arg))) checkout = resolve(arg);
  else {
    const tag = arg ? (arg.startsWith("v") ? arg : `v${arg}`) : await latest();
    label = `eta ${tag}`;
    console.log(`Fetching eta ${tag} from GitHub...`);
    scratch = mkdtempSync(join(tmpdir(), "eta-update-"));
    checkout = await download(tag, scratch);
  }
  const kit = join(checkout, "create/eta.ts");
  if (!existsSync(kit)) throw new Error(`${label} has no create/eta.ts: it is an eta from before eta:update, which cannot make eta/: name a later one`);
  const { update } = (await import(kit)) as { update: (root: string, checkout: string) => Promise<boolean> };
  ok = await update(root, checkout);
} catch (err) {
  console.error(`eta:update: ${(err as Error).message}`);
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);

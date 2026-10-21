#!/usr/bin/env bun
/**
 * The checkout's packages (railroad, delta, dzql) installed in a project as npm ships them: each
 * packed once into a tarball, the project's `file:` links to the checkout's folders pointed at the
 * tarballs, and anything still linked into the checkout put back as it ships. A session working in
 * the project then reads only what ships, never the repository through its links. Used by
 * `scripts/evals.ts` (each scenario's project) and the Shed's driver (its app, before stage 1).
 *
 * `bun scripts/packed.ts <project> [<tarballs dir>]`: that project, its tarballs kept in the folder
 * named, else beside the project (`besides`).
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");

/** Each package of the checkout, by the name an app depends on it by, and its folder under `packages/`. */
export const LOCAL: Record<string, string> = { dzql: "dzql", "@blueshed/delta": "delta", "@blueshed/railroad": "railroad" };

const sh = (cmd: string[], cwd: string) => Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, CI: "" } });

/** The packer for one run: tarballs packed once into `dest`, and what installs them. */
export function packer(dest: string) {
  const tarballs = new Map<string, string>();

  /** The tarball of `pkg` (a folder under `packages/`), as npm would ship it, packed once a run. */
  function tarball(pkg: string): string {
    if (!tarballs.has(pkg)) {
      mkdirSync(dest, { recursive: true });
      const packed = sh(["bun", "pm", "pack", "--destination", dest, "--ignore-scripts", "--quiet"], join(root, "packages", pkg));
      const file = packed.stdout.toString().trim().split("\n").at(-1)!;
      if (packed.exitCode !== 0 || !existsSync(file)) throw new Error(`packing ${pkg}: ${packed.stderr.toString()}`);
      tarballs.set(pkg, file);
    }
    return tarballs.get(pkg)!;
  }

  /**
   * A `file:` install is a folder of links into the checkout, which a session's search does not
   * follow (it then reads the checkout, outside its project): each is put back as the package ships,
   * its own node_modules kept, at every depth. A peer the install nested under it (a second railroad,
   * whose signals the page's never see) goes, as npm would: the app's own is the one, or the first,
   * hoisted, where the app has none.
   */
  function shipped(modules: string, top = modules): void {
    if (!existsSync(modules)) return;
    if (modules !== top)
      for (const name of Object.keys(LOCAL)) {
        if (!existsSync(join(modules, name))) continue;
        if (existsSync(join(top, name))) rmSync(join(modules, name), { recursive: true, force: true });
        else (mkdirSync(dirname(join(top, name)), { recursive: true }), renameSync(join(modules, name), join(top, name)), shipped(top)); // hoisted, the one copy
      }
    for (const [name, pkg] of Object.entries(LOCAL)) {
      const at = join(modules, name);
      if (!existsSync(at) || !readdirSync(at).some((f) => lstatSync(join(at, f)).isSymbolicLink())) continue;
      const tmp = mkdtempSync(join(modules, ".shipped-"));
      sh(["tar", "-xzf", tarball(pkg), "-C", tmp], tmp);
      if (existsSync(join(at, "node_modules"))) renameSync(join(at, "node_modules"), join(tmp, "package", "node_modules"));
      rmSync(at, { recursive: true, force: true });
      renameSync(join(tmp, "package"), at);
      rmSync(tmp, { recursive: true, force: true });
      shipped(join(at, "node_modules"), top);
    }
  }

  /** A package.json's `file:` links to the checkout's packages pointed at their tarballs instead; whether any was. */
  function packed(file: string): boolean {
    const pkg = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, string> | undefined>;
    let changed = false;
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "overrides"])
      for (const [name, dir] of Object.entries(LOCAL))
        if (pkg[field]?.[name]?.startsWith("file:") && !pkg[field]![name]!.endsWith(".tgz")) (pkg[field]![name] = `file:${tarball(dir)}`), (changed = true);
    if (changed) writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
    return changed;
  }

  /**
   * A project installed as it ships: its package.json's links to the checkout made tarballs (a
   * starter's --local names their folders, whose devDependencies come along and hide what the app
   * never added), installed again, and anything still linked unlinked.
   */
  function ship(dir: string): void {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg) && packed(pkg)) rmSync(join(dir, "node_modules"), { recursive: true, force: true });
    if (existsSync(pkg) && !existsSync(join(dir, "node_modules"))) sh(["bun", "install"], dir);
    shipped(join(dir, "node_modules"));
  }

  return { tarball, shipped, packed, ship };
}

/** Where a project's tarballs are kept when nothing says: beside it, never in it, for as long as it names them. */
export const besides = (dir: string) => join(dirname(resolve(dir)), `.${basename(resolve(dir))}.packed`);

/** What in `modules` is a link into the checkout: `ship` leaves none. */
export function linksInto(modules: string, checkout = root): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const at = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let to: string;
        try { to = resolve(dirname(at), readlinkSync(at)); } catch { continue; }
        if (to === checkout || to.startsWith(`${checkout}/`)) found.push(at);
      } else if (entry.isDirectory()) walk(at);
    }
  };
  if (existsSync(modules)) walk(modules);
  return found;
}

if (import.meta.main) {
  const [project, dest] = process.argv.slice(2);
  if (!project) {
    console.error("Which project? bun scripts/packed.ts <project> [<tarballs dir>]");
    process.exit(2);
  }
  const dir = resolve(project);
  packer(dest ? resolve(dest) : besides(dir)).ship(dir);
  const left = linksInto(join(dir, "node_modules"));
  if (left.length) {
    console.error(`still linked into the checkout:\n${left.join("\n")}`);
    process.exit(1);
  }
  console.log(`${dir}: installed as it ships`);
}

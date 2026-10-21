/**
 * `delta install-skills`: vendor Claude Code skills into the consumer's
 * .claude/skills/ directory. Discovers skills from:
 *   - this package itself  (delta-doc)
 *   - @blueshed/* packages in node_modules with `.claude/skills/<name>/SKILL.md`
 *     (e.g. @blueshed/railroad ships `railroad` and `bun-route`)
 *   - any other package the consumer names in its package.json `claudeSkills`
 * A skill is instructions an agent follows, so a package that merely sits in
 * node_modules (a dependency of a dependency) does not get to ship one.
 *
 * Skills aren't versioned like SQL — we always overwrite, but back up the
 * existing file as `.bak` so a consumer who edited their copy doesn't lose
 * it. The backup is kept outside the skills folder, in `.claude/skills-backup/
 * <skill>/` (an app's `prepare` runs this, and a backup beside the page was
 * committed with its skills), and one an older install left beside a page is
 * moved there. Bytewise-identical destinations are skipped. Each skill folder installed
 * mirrors its source: a file the source no longer has is removed (a skill
 * that split reference.md into reference/ leaves no stale reference.md
 * beside it), never outside the folders installed.
 * @internal
 */
import { resolve, basename, join, dirname } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, copyFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, type Dirent } from "node:fs";

/** The package this ships in: its own skills, and its node_modules during development. */
const packageRoot = resolve(import.meta.dir, "../..");

/**
 * Back up `dest` to `backup + ".bak"` (its place in the backup folder) without
 * destroying a pre-existing backup. If that already exists, fall back to
 * `.bak.1`, `.bak.2`, … so an earlier backup the user may still need is
 * preserved. Moves the file there with `move`, else copies it. Returns the path
 * the backup was written to.
 */
function backupFile(dest: string, backup: string, move = false): string {
  mkdirSync(dirname(backup), { recursive: true });
  let bak = backup + ".bak";
  if (existsSync(bak)) {
    let n = 1;
    while (existsSync(`${backup}.bak.${n}`)) n++;
    bak = `${backup}.bak.${n}`;
    process.stderr.write(
      `Note: ${basename(backup)}.bak already exists; backing up to ${basename(bak)} instead.\n`,
    );
  }
  if (move) renameSync(dest, bak);
  else copyFileSync(dest, bak);
  return bak;
}

interface SkillSource {
  name: string;     // e.g. "delta-doc", "railroad", "bun-route"
  srcDir: string;   // absolute path to the skill directory
  origin: string;   // e.g. "@blueshed/delta", "@blueshed/railroad" — for the log
}

function listSkillsIn(skillsRoot: string, origin: string): SkillSource[] {
  if (!existsSync(skillsRoot)) return [];
  const out: SkillSource[] = [];
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!isDir(skillsRoot, entry)) continue;
    const dir = join(skillsRoot, entry.name);
    if (existsSync(join(dir, "SKILL.md"))) {
      out.push({ name: entry.name, srcDir: dir, origin });
    }
  }
  return out;
}

function findNodeModulesDir(start: string): string | null {
  // Walk up looking for the first node_modules dir that contains us.
  // This handles dev (running from the delta repo, where ./node_modules holds
  // sibling packages like railroad) and consumer use (where the consumer's
  // node_modules holds @blueshed/delta and any other sibling packages).
  let cur = resolve(start);
  while (true) {
    const candidate = join(cur, "node_modules");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/** The packages outside @blueshed/* whose skills the consumer asked for: package.json `claudeSkills`. */
function allowedSkillPackages(): Set<string> {
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
    return new Set(Array.isArray(pkg.claudeSkills) ? pkg.claudeSkills.filter((n: unknown) => typeof n === "string") : []);
  } catch {
    return new Set();
  }
}

/** A folder, or a link to one: a workspace links its packages into node_modules. */
function isDir(parent: string, entry: Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try { return statSync(join(parent, entry.name)).isDirectory(); }
  catch { return false; }
}

/** A file, or a link to one: a package installed from a checkout (`file:`, a workspace) may be links, file by file. */
function isFile(parent: string, entry: Dirent): boolean {
  if (entry.isFile()) return true;
  if (!entry.isSymbolicLink()) return false;
  try { return statSync(join(parent, entry.name)).isFile(); }
  catch { return false; }
}

function discoverSkillSources(): SkillSource[] {
  const sources = new Map<string, SkillSource>();   // by name: the first found wins
  const add = (s: SkillSource) => void (sources.has(s.name) || sources.set(s.name, s));
  const allowed = allowedSkillPackages();

  // Our own skills: those this package ships (its package.json `files`). In development its
  // .claude/skills holds railroad's too, put there by this command (`prepare`): that one is railroad's.
  const shipped = (JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).files as string[]).flatMap((f) => /^\.claude\/skills\/([^/]+)\//.exec(f)?.[1] ?? []);
  listSkillsIn(join(packageRoot, ".claude/skills"), "@blueshed/delta").filter((s) => shipped.includes(s.name)).forEach(add);

  // Sibling packages. Look in both: the consumer's cwd-rooted node_modules first (what
  // it installed wins a name), then the package the CLI lives in (its own node_modules during dev).
  const candidateRoots = new Set<string>();
  for (const start of [process.cwd(), packageRoot]) {
    const nm = findNodeModulesDir(start);
    if (nm) candidateRoots.add(nm);
  }

  for (const nm of candidateRoots) {
    // Walk node_modules: scoped (@scope/pkg) AND unscoped (pkg).
    let entries: Dirent[];
    try { entries = readdirSync(nm, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (!isDir(nm, entry)) continue;
      const pkgDirs: { name: string; dir: string }[] = [];
      if (entry.name.startsWith("@")) {
        let subEntries: Dirent[];
        try { subEntries = readdirSync(join(nm, entry.name), { withFileTypes: true }); }
        catch { continue; }
        for (const sub of subEntries) {
          if (isDir(join(nm, entry.name), sub)) {
            pkgDirs.push({ name: `${entry.name}/${sub.name}`, dir: join(nm, entry.name, sub.name) });
          }
        }
      } else {
        pkgDirs.push({ name: entry.name, dir: join(nm, entry.name) });
      }
      for (const { name, dir } of pkgDirs) {
        // Skip ourselves (added above).
        if (name === "@blueshed/delta") continue;
        const skillsRoot = join(dir, ".claude/skills");
        if (!name.startsWith("@blueshed/") && !allowed.has(name)) {
          if (listSkillsIn(skillsRoot, name).length) {
            process.stderr.write(`  skipped ${name}: not @blueshed/*, and not in package.json "claudeSkills"\n`);
          }
          continue;
        }
        listSkillsIn(skillsRoot, name).forEach(add);
      }
    }
  }

  return [...sources.values()];
}

type CopyAction = "created" | "upgraded" | "unchanged";

/** Copy `src` over `dest`, a file it replaces backed up at its place under `backups`. */
function copyDirWithBackup(
  src: string,
  dest: string,
  backups: string,
  dryRun: boolean,
  onFile: (relPath: string, action: CopyAction) => void,
  prefix = "",
): void {
  if (!dryRun) mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (isDir(src, entry)) {
      copyDirWithBackup(srcPath, destPath, join(backups, entry.name), dryRun, onFile, rel);
      continue;
    }
    if (!isFile(src, entry)) continue;
    if (existsSync(destPath)) {
      const a = readFileSync(srcPath);
      const b = readFileSync(destPath);
      if (a.equals(b)) { onFile(rel, "unchanged"); continue; }
      if (!dryRun) {
        backupFile(destPath, join(backups, entry.name));
        copyFileSync(srcPath, destPath);
      }
      onFile(rel, "upgraded");
    } else {
      if (!dryRun) copyFileSync(srcPath, destPath);
      onFile(rel, "created");
    }
  }
}

/** A backup an older install-skills left beside a page (`x.bak`, `x.bak.1`): the consumer's, moved out, never pruned. */
const backupOf = (name: string) => /^(.+)\.bak(\.\d+)?$/.exec(name)?.[1];

/**
 * Remove from `dest` what `src` no longer has (`src` null: a folder the source
 * dropped), a backup moved to its place under `backups`; a folder left empty goes too.
 */
function pruneDir(
  src: string | null,
  dest: string,
  backups: string,
  dryRun: boolean,
  onRemove: (relPath: string, moved: boolean) => void,
  prefix = "",
): void {
  if (!existsSync(dest)) return;
  for (const entry of readdirSync(dest, { withFileTypes: true })) {
    const srcPath = src && join(src, entry.name);
    const destPath = join(dest, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const kept = srcPath && existsSync(srcPath) ? srcPath : null;
      pruneDir(kept, destPath, join(backups, entry.name), dryRun, onRemove, rel);
      if (!kept && !dryRun && readdirSync(destPath).length === 0) rmdirSync(destPath);
      continue;
    }
    const page = backupOf(entry.name);
    if (page) {
      if (!dryRun) backupFile(destPath, join(backups, page), true);
      onRemove(rel, true);
      continue;
    }
    if (srcPath && existsSync(srcPath)) continue;
    if (!dryRun) rmSync(destPath);
    onRemove(rel, false);
  }
}

/** `delta install-skills [--user] [--dry-run] [--skip <name,...>]`. */
export function installSkills(values: Record<string, unknown>): void {
  const user = !!values.user;
  const dryRun = !!values["dry-run"];
  const root = user
    ? join(homedir(), ".claude/skills")
    : resolve(process.cwd(), ".claude/skills");

  const skip = new Set(String(values.skip ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const sources = discoverSkillSources().filter((s) => !skip.has(s.name));
  if (sources.length === 0 && skip.size === 0) {
    process.stderr.write(
      `install-skills: no skills found (expected delta-doc bundled with this package).\n`,
    );
    process.exit(2);
  }

  // backups beside the skills, never in them: an app commits its skills (`prepare` runs this)
  const backupRoot = join(dirname(root), "skills-backup");
  process.stderr.write(
    `${dryRun ? "[dry-run] " : ""}Installing ${sources.length} skill(s) → ${root}\n`,
  );

  for (const { name, srcDir, origin } of sources) {
    const destDir = join(root, name);
    const backups = join(backupRoot, name);
    const did: Record<CopyAction | "removed" | "moved", string[]> = { created: [], removed: [], moved: [], upgraded: [], unchanged: [] };
    // an older install's backups moved out first, so they keep the earlier names
    pruneDir(srcDir, destDir, backups, dryRun, (rel, moved) => did[moved ? "moved" : "removed"].push(rel));
    copyDirWithBackup(srcDir, destDir, backups, dryRun, (rel, action) => did[action].push(rel));
    const mark = { created: "+", removed: "-", moved: ">", upgraded: "~", unchanged: "=" } as const;
    const said = { upgraded: " (.bak in .claude/skills-backup)", moved: " (to .claude/skills-backup)" } as Record<string, string>;
    const parts = (Object.keys(mark) as (keyof typeof mark)[]).filter((k) => did[k].length)
      .map((k) => `${mark[k]}${did[k].join(", ")}${said[k] ?? ""}`);
    process.stderr.write(`  ${name}  [${origin}]  ${parts.join("  ") || "nothing to do"}\n`);
  }
}

import { expect, test } from "bun:test";
import { join } from "node:path";

// "A builder opens eta in a fresh Claude Code web session, and `bun test` is green."
// .claude/hooks/session-start.sh gets the session there. What it installs, inside the sandbox,
// cannot run here; what it reads of eta to decide, and that it does nothing anywhere else, can.

const root = join(import.meta.dir, "..");
const hook = (args: string[], env: Record<string, string | undefined>) => {
  const { CLAUDE_CODE_REMOTE: _, ...rest } = process.env;
  const p = Bun.spawnSync(["bash", join(root, ".claude/hooks/session-start.sh"), ...args], { cwd: root, env: { ...rest, CLAUDE_PROJECT_DIR: root, ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

test("a builder opens eta in a fresh Claude Code web session, and `bun test` is green: the hook reads what eta's tests need", async () => {
  const { engines } = await Bun.file(join(root, "package.json")).json();
  const { code, out, err } = hook(["--dry-run"], {});
  expect({ code, out }).toEqual({ code: 0, out: "" }); // progress goes to stderr: stdout would join the session's context
  expect(err).toContain(`wants ${engines.bun}: ok`); // the floor is package.json's, and this Bun is above it
  expect(err).toContain("chromium: a test uses Bun.WebView");
  expect(err).toContain("postgres: not needed");
});

test("the hook is the session's, and outside the web sandbox it does nothing at all", async () => {
  const settings = await Bun.file(join(root, ".claude/settings.json")).json();
  expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('bash "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh"');
  expect(hook([], {})).toEqual({ code: 0, out: "", err: "" });
  // on a Mac, even in a session that says it is remote: Bun is there, and WebKit for Bun.WebView
  if (process.platform === "darwin") expect(hook([], { CLAUDE_CODE_REMOTE: "true" })).toEqual({ code: 0, out: "", err: "" });
});

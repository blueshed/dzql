// One Shed stage, as runs 2 and 3 ran it: a fresh Claude Code session in the app, given one line, the
// people, and the stage's stories, with nobody stepping in. Says how long it took.
// bun stage.ts <app dir> <stage 1-5> <log file>; run.ts runs all five: bun run.ts <app dir>
const [app, n, log] = process.argv.slice(2) as [string, string, string];
const stories = await Bun.file(`${import.meta.dir}/../stories.md`).text();
const people = stories.slice(stories.indexOf("The people:"), stories.indexOf("## Stage 1"));
const at = stories.indexOf(`## Stage ${n}:`);
const next = stories.indexOf("## Stage ", at + 5);
const stage = stories.slice(at, next < 0 ? undefined : next).trim();
const prompt = `Make these stories true:\n\n${people.trim()}\n\n${stage}\n`;
await Bun.write(`${log}.prompt.md`, prompt);
const started = performance.now();
const proc = Bun.spawn(["claude", "-p", prompt, "--allowedTools", "Bash,Edit,Write,Read,Glob,Grep,MultiEdit,TodoWrite", "--permission-mode", "acceptEdits", "--output-format", "text"], { cwd: app, stdout: Bun.file(log), stderr: "pipe", stdin: "ignore" });
const code = await proc.exited;
const minutes = ((performance.now() - started) / 60000).toFixed(1);
console.log(`stage ${n}: exit ${code}, ${minutes} minutes`);

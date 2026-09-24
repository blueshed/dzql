// An agreement's state machine, checked against the stories that move it. Each arrow cites its
// stories by number, as drawn:
//
//   invited --> accepted : venueOwner accepts (30)
//   invited -[dotted]-> accepted : authority cannot (35)
//
// The role is the arrow's first word; a dotted arrow is a refusal and cites `cannot` stories. Each
// story is read for what it says, and two questions are put to every move:
//
//   do I have what I need to act? -- everyone with a move out of the state it lands in is told
//                                    (in its `seen`), so nobody's turn is blind.
//   can I see the consequences?   -- everyone whose move put the thing in the state it leaves is
//                                    told, so nobody waits on an answer that came.
//
// The parties are those told when the thing is made; anyone else joins it when first told of it by
// someone else's move (Sam joins a deployment when he is put on it), and is asked after only from
// the states that follow.
//
// A story that sets a status must set this arrow's target, a creation ([*] -->) adds. Two states
// with one value are drawn with an alias: `state "granted" as own`. An arrow to [*] with no label
// says the thing ends there: to go again, a new one is made. A state with no move out that is not
// drawn as an end is undecided, and says so. The marks are drawn at render time; the diagram's
// source stays as written.

type Seen = Record<string, string> | string[];
type Write = { doc: string; ops: { op: string; path: string; value?: unknown }[] };
export type Story = { name: string; as: string; does?: Write; cannot?: Write; seen?: Seen };

export type Arrow = { line: number; from: string; to: string; style: string; role: string; words: string; cites: number[]; refusal: boolean };
export type Mark = { arrow: Arrow; problems: string[] };

const ARROW = /^\s*(\[\*\]|\w+)\s*(-[^>\s]*>)\s*(\[\*\]|\w+)\s*:\s*(\w+)\s+(.*?)\s*\(([\d,\s]+)\)\s*$/;
const MOVES = /\/(status|available)$/;

export function arrows(puml: string): Arrow[] {
  const out: Arrow[] = [];
  puml.split("\n").forEach((text, line) => {
    const m = text.match(ARROW);
    if (!m) return;
    out.push({ line, from: m[1]!, to: m[3]!, style: m[2]!, role: m[4]!, words: m[5]!, cites: m[6]!.split(",").map((n) => Number(n.trim())), refusal: m[2]!.includes("dotted") });
  });
  return out;
}

/** The states drawn as ends: `declined --> [*]`. */
export function ends(puml: string): Set<string> {
  return new Set([...puml.matchAll(/^\s*(\w+)\s*-[^>\s]*>\s*\[\*\]\s*$/gm)].map((m) => m[1]!));
}

/** Each state's value: its name, or what its alias stands for (`state "granted" as own`). */
export function values(puml: string): (state: string) => string {
  const alias = new Map([...puml.matchAll(/^\s*state\s+"([^"]+)"\s+as\s+(\w+)/gm)].map((m) => [m[2]!, m[1]!]));
  return (state) => alias.get(state) ?? state;
}

/** The roles a story tells, with the page each has open: "" is home. */
export function told(s: Story): Map<string, string> {
  const seen = s.seen ?? {};
  const entries = Array.isArray(seen) ? seen.map((r) => [r, ""] as const) : Object.entries(seen);
  return new Map(entries.map(([r, page]) => [r, page.split(" @ ")[0] || "home"]));
}

type Turns = { movers: Map<string, Set<string>>; arrivers: Map<string, Set<string>>; present: (role: string, state: string) => boolean };

/** Who has a move out of each state, whose moves put the thing in it, and where each party is on it. */
function turns(all: Arrow[], stories: Story[]): Turns {
  const moves = all.filter((a) => !a.refusal);
  const movers = new Map<string, Set<string>>(), arrivers = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, r: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(r);
  for (const a of moves) { add(movers, a.from, a.role); add(arrivers, a.to, a.role); }
  const heard = (a: Arrow) => a.cites.flatMap((n) => [...told(stories[n - 1] ?? { name: "", as: "" }).keys()]);
  const founders = new Set(moves.filter((a) => a.from === "[*]").flatMap((a) => [a.role, ...heard(a)]));
  const joined = new Map<string, Set<string>>();
  for (const a of moves) if (a.from !== "[*]") for (const r of heard(a)) if (r !== a.role && !founders.has(r)) add(joined, r, a.from);
  for (const states of joined.values()) {
    for (let grew = true; grew; ) {
      grew = false;
      for (const a of moves) if (states.has(a.from) && a.to !== "[*]" && !states.has(a.to)) { states.add(a.to); grew = true; }
    }
  }
  const present = (role: string, state: string) => founders.has(role) || !!joined.get(role)?.has(state);
  return { movers, arrivers, present };
}

export function checkAgreement(puml: string, stories: Story[]): { marks: Mark[]; drift: string[]; cited: Set<number> } {
  const all = arrows(puml);
  const { movers, arrivers, present } = turns(all, stories);
  const value = values(puml);
  const cited = new Set<number>(), drift: string[] = [];
  const marks = all.map((a) => {
    const problems: string[] = [];
    for (const n of a.cites) {
      cited.add(n);
      const s = stories[n - 1];
      if (!s) { problems.push(`(${n}) is not a story`); continue; }
      if (s.as !== a.role) problems.push(`(${n}) is told as ${s.as}, not ${a.role}`);
      if (a.refusal) { if (!s.cannot) problems.push(`(${n}) is a move, not a refusal`); continue; }
      if (!s.does) { problems.push(`(${n}) is a refusal, drawn as a move`); continue; }
      const statuses = s.does.ops.filter((o) => /\/status$/.test(o.path)).map((o) => String(o.value));
      if (a.from === "[*]") { if (!s.does.ops.some((o) => o.op === "add")) problems.push(`(${n}) does not make one`); }
      else if (statuses.length && !statuses.includes(value(a.to)) && a.from !== a.to) problems.push(`(${n}) sets ${statuses.join(", ")}, not ${value(a.to)}`);
      const heard = told(s);
      const on = (r: string) => a.from === "[*]" || present(r, a.from);
      for (const r of movers.get(a.to) ?? []) if (!heard.has(r) && on(r)) problems.push(`${r} is not told, and it is their move (${n})`);
      if (a.from !== a.to) for (const r of arrivers.get(a.from) ?? []) if (!heard.has(r) && on(r)) problems.push(`${r} is not told, and they were waiting on it (${n})`);
    }
    return { arrow: a, problems };
  });
  for (const m of marks) for (const p of m.problems) drift.push(`${m.arrow.from} → ${m.arrow.to}: ${p}`);
  const ended = ends(puml);
  for (const st of new Set(all.filter((a) => !a.refusal).map((a) => a.to))) if (st !== "[*]" && !movers.has(st) && !ended.has(st)) drift.push(`${st}: no move out of it, and it is not drawn as an end`);
  return { marks, drift, cited };
}

/** The stories that move a status and are on no diagram yet. */
export function uncited(stories: Story[], cited: Set<number>): string[] {
  return stories.flatMap((s, i) => ((s.does ?? s.cannot)!.ops.some((o) => MOVES.test(o.path)) && !cited.has(i + 1) ? [`(${i + 1}) ${s.as}: ${s.name}`] : []));
}

/** Every story, by the number the diagrams cite it by. */
export function numbered(stories: Story[]): string {
  return stories.map((s, i) => `(${i + 1}) ${s.as}${s.cannot ? " cannot" : ""}: ${s.name}`).join("\n");
}

const esc = (s: string) => s.replace(/[{}\]\[]/g, " ");

/** The diagram with its marks: each arrow says who is told and where, red where a check fails, and each state says whose move it is. Hovering an arrow shows its stories. */
export function markAgreement(puml: string, name: string, stories: Story[]): string {
  const { marks } = checkAgreement(puml, stories);
  const all = marks.map((m) => m.arrow);
  const { movers } = turns(all, stories);
  const ended = ends(puml);
  const lines = puml.split("\n");
  for (const { arrow: a, problems } of marks) {
    const s = a.cites.map((n) => stories[n - 1]).filter(Boolean) as Story[];
    const style = problems.length ? "-[#c0392b,bold]->" : a.refusal ? "-[#999999,dotted]->" : a.style;
    const pages = new Map<string, Set<string>>();
    if (!a.refusal) for (const x of s) for (const [r, p] of told(x)) if (r !== a.role) (pages.get(r) ?? pages.set(r, new Set()).get(r)!).add(p);
    const heard = [...pages].map(([r, p]) => `${r} @ ${[...p].join(" / ")}`).join(", ");
    const tip = esc(s.map((x) => x.name).join(" / "));
    let label = `[[#${name}{${tip}} ${a.role} ${a.words} (${a.cites.join(", ")})]]`;
    if (a.refusal) label = `<color:#888888>${label} ✗</color>`;
    if (heard) label += `\\n<size:10><color:#555555>told: ${heard}</color></size>`;
    for (const p of problems) label += `\\n<color:#c0392b>⚠ ${p}</color>`;
    lines[a.line] = `${a.from} ${style} ${a.to} : ${label}`;
  }
  const states = new Set(all.flatMap((a) => [a.from, a.to]).filter((x) => x !== "[*]"));
  const turnLines = [...states].map((st) => {
    const who = [...(movers.get(st) ?? [])];
    if (who.length) return `${st} : <size:11>move: ${who.join(", ")}</size>`;
    return ended.has(st) ? `${st} : <size:11><color:#888888>ends: to go again, make a new one</color></size>` : `${st} : <size:11><color:#c0392b>⚠ no move, and not an end</color></size>`;
  });
  const end = lines.findLastIndex((l) => /@enduml/.test(l));
  lines.splice(end, 0, ...turnLines);
  return lines.join("\n");
}

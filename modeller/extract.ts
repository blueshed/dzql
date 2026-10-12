// The facts a modeller page shows, read from an example as it stands: its stories, its delta.ts
// (tables, and documents as root + include), its compartments' permit rules, what the harness
// says when it runs the stories, and its documents as that run read them (documents.ts). Nothing
// here is proposed; everything is read. A project with no app yet (no index.ts) is read from its
// stories alone: no run, so nothing of who was told.

import type { Stories, Story } from "../src/stories";
import type { Example } from "../src/example";
import { parsePointer } from "../src/json-pointer";
import { run } from "../src/harness";
import { documentsIn, heardAs, privateEntry, read, typeOf, watch, exampleAt } from "./documents";
import { heartOf } from "./heart";

type Column = { type: string; nullable?: boolean };
type Permit = { doc: string; path: string; ops: string[]; dated: boolean };

/** A compartment's `RULES`, as written: a path pattern and the ops it allows, each. None when its permit is code, not a list. */
export function rulesIn(src: string): { path: RegExp; ops: string[]; dated?: boolean }[] {
  const body = src.match(/const RULES: Rule\[\] = (\[[\s\S]*?\n\]);/)?.[1];
  if (!body) return [];
  const pre = [...src.matchAll(/^const (LIST|CHILD) = "[^"]*";$/gm)].map((m) => m[0]).join("\n");
  return new Function(`${pre}\nreturn ${body};`)();
}

export async function extract(at: string) {
  const { dir, name } = exampleAt(at);
  const { stories } = (await import(`${dir}/stories.ts`)) as { stories: Stories };
  const deltaMod = await import(`${dir}/delta.ts`);
  const session = stories.goTo?.("").doc ?? null;

  // ── tables: delta.ts's schema ──
  // Where each table is touched outside delta.ts and the documents delta composes: the seed that
  // makes its rows, and any code that reads or writes it with its own SQL. A table the stories never
  // reach but code does is how a concept arrives without a story. The stories are not code: a
  // table's name in one is a path or a word, never a read.
  const files: { path: string; lines: string[] }[] = [];
  for await (const f of new Bun.Glob("**/*.{ts,sql}").scan(dir)) {
    if (f.includes(".test.") || f === "delta.ts" || f === "stories.ts" || f.startsWith("node_modules/")) continue;
    files.push({ path: f, lines: (await Bun.file(`${dir}/${f}`).text()).split("\n") });
  }
  const touches = (sqlName: string) =>
    files.flatMap(({ path, lines }) =>
      lines.flatMap((line, i) => (new RegExp(`\\b${sqlName}\\b`).test(line) ? [{ at: `${path}:${i + 1}`, seed: path.endsWith(".sql"), line: line.trim().slice(0, 140) }] : [])),
    );
  const schema = Object.entries(deltaMod.schema.tables as Record<string, { name: string; parent?: { collection: string }; columns: Record<string, Column> }>).map(([key, t]) => ({
    name: key,
    parent: t.parent?.collection ?? null,
    columns: Object.entries(t.columns).map(([c, def]) => ({ name: c, type: def.type + (def.nullable ? "?" : "") })),
    code: touches(t.name),
    sql: t.name,
  }));
  const tables = schema.map(({ sql: _, ...t }) => t);

  const documents = documentsIn(await Bun.file(`${dir}/delta.ts`).text(), session);

  // ── permits: each compartment's RULES, as written ──
  const permits: Permit[] = [];
  for (const { name: doc } of documents) {
    const file = Bun.file(`${dir}/compartments/${doc}.ts`);
    if (await file.exists()) for (const r of rulesIn(await file.text())) permits.push({ doc, path: r.path.source, ops: r.ops, dated: !!r.dated });
  }
  const ruled = new Set(permits.map((p) => p.doc));
  /** Whether a rule allows it; unknown (null) where the document's permit is code, not a list of rules. */
  const permitted = (doc: string, op: string, path: string) => (ruled.has(doc) ? permits.some((p) => p.doc === doc && p.ops.includes(op) && new RegExp(p.path).test(path)) : null);

  // ── stories, with each write placed on its document's tables ──
  const docByName = new Map(documents.map((d) => [d.name, d]));
  function place(doc: string, path: string): { table: string | null; field: string | null } {
    const d = docByName.get(typeOf(doc));
    if (!d?.root) return { table: null, field: parsePointer(path)[0] ?? null };
    const known = new Set([d.root, ...d.include]);
    let table = d.root;
    for (const seg of parsePointer(path)) {
      if (seg === "-" || /^\d+$/.test(seg)) continue;
      if (!known.has(seg)) return { table, field: seg };
      table = seg;
    }
    return { table, field: null };
  }

  // Every write the run makes, as the wire carried it: for a sequence drawn from a real run. None
  // where there is no app to run.
  const app = await Bun.file(`${dir}/index.ts`).exists();
  const example = app ? ((await import(`${dir}/index.ts`)) as { example: Example }).example : undefined;
  const watched = example && watch(example);
  const report = example && (await run(example, stories, watched!.observe, { everywhere: watched!.everywhere }));
  const traces = Map.groupBy(watched?.traces ?? [], (t) => t.story);
  // a session's id is a credential: it never reaches the page (a trace is a run's, and a run has an example)
  const shown = example && privateEntry(example);
  const outcome = new Map(report ? report.outcomes.map((o) => [o.name, o.failures]) : []);

  const storyRows = stories.stories.map((s: Story, i) => {
    const w = s.does ?? s.cannot;
    const seen = s.seen ?? {};
    return {
      n: i + 1,
      name: s.name,
      as: s.as,
      kind: s.does ? "does" : s.cannot ? "cannot" : "closesTab",
      doc: w?.doc ?? null,
      session: w?.doc === session,
      ops: (w?.ops ?? []).map((op) => ({ op: op.op, path: op.path, ...place(w!.doc, op.path), permitted: permitted(w!.doc, op.op, op.path) })),
      seen: Array.isArray(seen) ? Object.fromEntries(seen.map((m) => [m, null])) : seen,
      untold: s.untold ?? [],
      premise: s.premise !== undefined,
      offPage: !!s.offPage,
      failures: outcome.get(s.name) ?? ["not run"],
      sequence: (traces.get(s.name) ?? []).map((t) => ({ phase: t.phase, as: t.as, write: t.write, ledger: t.ledger.map(shown!), heard: t.heard.map((h) => ({ member: h.member, messages: h.messages.map(heardAs) })) })),
    };
  });

  const cast = Object.keys(stories.cast);
  const castSetup = Object.fromEntries(cast.map((m) => [m, stories.cast[m]!.flatMap((w) => w.ops.map((o) => `${w.doc} ${o.path} = ${"value" in o ? JSON.stringify(o.value) : ""}`))]));
  for (const s of storyRows) if (!cast.includes(s.as)) cast.push(s.as);

  const todo = (await Bun.file(`${import.meta.dir}/../todo.jsonl`).text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const tasks = todo.map((t: { n: number; status: string; summary: string; area: string }) => ({ n: t.n, status: t.status, summary: t.summary, area: t.area }));

  const reading = example ? read(stories, example, watched, documents.map((d) => d.name)) : read(stories);
  const perSession = example?.compartments.filter((c) => c.perSession).map((c) => c.docType) ?? [];
  const heart = heartOf({ example: name, ran: reading.ran, session, perSession, stories: storyRows, rows: reading.stories, traces: watched?.traces ?? [], documents, tables: schema, files, cast: castSetup, held: reading.grid });

  return { example: name, session, cast, castSetup, tables, documents, permits, stories: storyRows, harness: report ? { passed: report.passed, failed: report.failed } : null, tasks, read: reading, heart };
}

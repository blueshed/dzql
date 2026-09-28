// The closure report: hjeli's six predicates over a pile of stories, what the stories give each
// one to read, and the checks that only stories can ask. Pure: the CLI (closure.ts) loads and
// prints; this reads and judges.

import type { Stories } from "../src/stories";
import type { Gap, Model } from "./model/grammar";
import { runAll } from "./model/predicates";
import { fromStories, locate, entityOf, noticing, type Note, type Reading } from "./from-stories";

/** What the stories give each predicate to read. Where they do not say what it asks, it passes. */
export const READS: Record<Gap["predicate"], string> = {
  reachability: "what a page watches is what the stories noticed on it: an entity is unwatched only if nobody notices a write to it",
  "subscription-closure": "the same reading: a write is silent only if nobody notices it",
  "actor-closure": "the cast, who tells, and who notices where",
  "precondition-closure": "the row tier (a row is added before it is changed); stories have no `requires`, so the state tier passes",
  "referential-closure": "names are the stories' own: documents, paths, keys",
  "authorization-closure": "stories do not say who owns a row, so it passes; `does` and `cannot` are the permit table instead",
};

export type Finding = { check: string; where: string; detail: string };

export type Report = {
  counts: { stories: number; does: number; cannot: number; closesTab: number; actors: number; pages: number; entities: number; fields: number };
  gaps: Gap[];
  /** Checks only stories can ask. */
  story: {
    /** A write whose author does not notice it. */
    authorBlind: Finding[];
    /** A field written by more than one actor: a candidate for a two-sided agreement, where each side writes its own. */
    manyWriters: Finding[];
    /** Fields that take more than one named state, and the replace-writes that move them. */
    states: { field: string; values: string[]; moves: number }[];
    /** Refusals, per entity: the permit table's other half. */
    refusals: Map<string, number>;
  };
  notes: Note[];
};

export function judge(stories: Stories): { reading: Reading; report: Report } {
  const reading = fromStories(stories);
  const { model } = reading;
  const gaps = runAll(model);

  const authorBlind: Finding[] = [];
  const writers = new Map<string, Set<string>>();
  const values = new Map<string, Set<string>>();
  const moves = new Map<string, number>();
  const refusals = new Map<string, number>();

  for (const s of stories.stories) {
    for (const op of s.cannot?.ops ?? []) {
      const entity = entityOf(locate(s.cannot!.doc, op.path).chain);
      refusals.set(entity, (refusals.get(entity) ?? 0) + 1);
    }
    if (!s.does || s.does.doc === reading.session) continue;
    const who = noticing(s).map(([m]) => m);
    if (!who.includes(s.as)) authorBlind.push({ check: "author-blind", where: s.name, detail: `${s.as} writes and does not notice; noticed by ${who.join(", ") || "nobody"}` });
  }
  for (const s of model.stories) {
    for (const w of s.writes) {
      if (!w.path) continue;
      const key = `${w.entity}.${w.path}`;
      writers.set(key, (writers.get(key) ?? new Set()).add(s.actor));
      if (w.op === "replace" && w.to !== undefined && !/^\d+(\.\d+)?$/.test(w.to) && !/^\d{4}-/.test(w.to)) {
        values.set(key, (values.get(key) ?? new Set()).add(w.to));
        moves.set(key, (moves.get(key) ?? 0) + 1);
      }
    }
  }
  const manyWriters: Finding[] = [...writers.entries()]
    .filter(([, a]) => a.size > 1)
    .map(([field, a]) => ({ check: "many-writers", where: field, detail: `written by ${[...a].sort().join(", ")}` }));
  // A field is a state when stories replace it with at least two different words (a status, a choice).
  const states = [...values.entries()]
    .filter(([, v]) => v.size > 1)
    .map(([field, v]) => ({ field, values: [...v].sort(), moves: moves.get(field)! }))
    .sort((a, b) => a.field.localeCompare(b.field));

  const count = (kind: "does" | "cannot" | "closesTab") => stories.stories.filter((s) => s[kind] !== undefined).length;
  return {
    reading,
    report: {
      counts: {
        stories: stories.stories.length,
        does: count("does"),
        cannot: count("cannot"),
        closesTab: count("closesTab"),
        actors: model.actors.length,
        pages: model.documents.length,
        entities: model.entities.length,
        fields: model.entities.reduce((n, e) => n + e.fields.length, 0),
      },
      gaps,
      story: { authorBlind, manyWriters, states, refusals },
      notes: reading.notes,
    },
  };
}

/** Another model of the same domain (hjeli's own), for the comparison: its verdict, and which entities the two readings share by name. */
export function compare(reading: Reading, other: Model, gaps: Gap[]) {
  // An entity of ours matches one of theirs by its whole chain (`OccasionEvent`) or by its own
  // collection alone (`Venue/areas` -> `Area`).
  const keys = (entity: string): string[] => {
    const path = reading.collections.get(entity) ?? entity;
    return [entity.toLowerCase(), entityOf([path.split("/").at(-1)!]).toLowerCase()];
  };
  const theirs = new Map(other.entities.map((e) => [e.name.toLowerCase(), e.name]));
  const matched = new Set<string>();
  const shared: string[] = [];
  const onlyOurs: string[] = [];
  for (const e of reading.model.entities) {
    const hit = keys(e.name).find((k) => theirs.has(k));
    if (hit) {
      matched.add(hit);
      shared.push(e.name === theirs.get(hit) ? e.name : `${e.name} = ${theirs.get(hit)}`);
    } else onlyOurs.push(e.name);
  }
  return {
    gaps: gaps.length,
    counts: { actors: other.actors.length, entities: other.entities.length, stories: other.stories.length },
    shared: shared.sort(),
    onlyOurs: onlyOurs.sort(),
    onlyTheirs: [...theirs.entries()].filter(([k]) => !matched.has(k)).map(([, v]) => v).sort(),
  };
}

export function format(name: string, report: Report, against?: ReturnType<typeof compare>): string {
  const c = report.counts;
  const lines: string[] = [];
  const out = (s = "") => lines.push(s);
  out(`# ${name}: closure over stories`);
  out();
  out(`${c.stories} stories (${c.does} does, ${c.cannot} cannot${c.closesTab ? `, ${c.closesTab} closes a tab` : ""}) · ${c.actors} actors · ${c.pages} pages · ${c.entities} entities · ${c.fields} fields`);
  out();
  out(`## hjeli's six predicates`);
  out();
  for (const [predicate, reads] of Object.entries(READS)) {
    const gs = report.gaps.filter((g) => g.predicate === predicate);
    out(`- ${predicate}: ${gs.length} gap${gs.length === 1 ? "" : "s"} — ${reads}`);
    for (const g of gs) out(`    ${g.kind} · ${g.where} — ${g.detail ?? ""}`);
  }
  out();
  out(`## What only stories can ask`);
  out();
  out(`- author-blind: ${report.story.authorBlind.length}`);
  for (const f of report.story.authorBlind) out(`    ${f.where} — ${f.detail}`);
  out(`- many-writers: ${report.story.manyWriters.length}`);
  for (const f of report.story.manyWriters) out(`    ${f.where} — ${f.detail}`);
  const moveCount = report.story.states.reduce((n, s) => n + s.moves, 0);
  out(`- states: ${report.story.states.length} fields move between named states, in ${moveCount} writes`);
  for (const s of report.story.states) out(`    ${s.field}: ${s.values.join(" · ")} (${s.moves})`);
  out(`- refusals: ${[...report.story.refusals.values()].reduce((a, b) => a + b, 0)} across ${report.story.refusals.size} entities`);
  for (const [e, n] of [...report.story.refusals.entries()].sort()) out(`    ${e}: ${n}`);
  out();
  out(`## What the stories do not say (${report.notes.length})`);
  out();
  const kinds = new Map<string, Note[]>();
  for (const n of report.notes) kinds.set(n.kind, [...(kinds.get(n.kind) ?? []), n]);
  for (const [kind, ns] of kinds) {
    out(`- ${kind}: ${ns.length}`);
    for (const n of ns) out(`    ${n.where} — ${n.detail}`);
  }
  if (against) {
    out();
    out(`## Against the other model`);
    out();
    out(`${against.counts.actors} actors · ${against.counts.entities} entities · ${against.counts.stories} stories · ${against.gaps} gaps`);
    out(`- shared by name (${against.shared.length}): ${against.shared.join(", ")}`);
    out(`- only in the stories (${against.onlyOurs.length}): ${against.onlyOurs.join(", ")}`);
    out(`- only in the model (${against.onlyTheirs.length}): ${against.onlyTheirs.join(", ")}`);
  }
  return lines.join("\n");
}

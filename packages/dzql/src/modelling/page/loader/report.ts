// The closure report: hjeli's predicates over a pile of stories, what the stories give each one to
// read, and the checks that only stories can ask. Pure: the CLI (closure.ts) loads and prints;
// this reads and judges.
//
// Two of the six are not run here: reachability and subscription closure ask what a document
// watches, and documents are documents.ts's now, read from the stories, the resources and a run --
// not invented one per actor per page, over which the one thing either could find was a write
// nobody notices (an empty `seen`). They run there, over the real documents (check.ts prints both):
// documents.ts's reachability is each table of the app's schema held by some document, its
// subscription closure a write that tells nobody, and actor closure's dead actor someone with
// nothing in front of them and nothing written. A row of the visitor's own document (`session`) is
// made by the visit, not a story: precondition closure's row tier does not ask a story to add it.

import { toldOf, writeOf, type Stories } from "dzql/modelling/stories";
import type { Gap, Model } from "./model/grammar";
import { actorClosure, authorizationClosure, preconditionClosure, referentialClosure } from "./model/predicates";
import { fromStories, locate, entityOf, noticing, type Note, type Reading } from "./from-stories";

/** What the stories give each predicate to read. Where they do not say what it asks, it passes. */
export const READS: Partial<Record<Gap["predicate"], string>> = {
  "actor-closure": "the cast, and who tells (a dead actor is the documents' grid's, not asked here)",
  "precondition-closure": "the row tier (a row is added before it is changed; a session's row by the visit); stories have no `requires`, so the state tier is not asked",
  "referential-closure": "names are the stories' own: documents, paths, keys",
  "authorization-closure": "stories do not say who owns a row, so it is not asked; `does` and `cannot` are the permit table instead",
};

export type Finding = { check: string; where: string; detail: string };

export type Report = {
  counts: { stories: number; does: number; cannot: number; closesTab: number; opensTab: number; actors: number; entities: number; fields: number };
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
  const byVisit = (g: Gap) => g.kind === "unestablished-row" && reading.madeByVisit.has(g.refs?.entity ?? "");
  const gaps = [...actorClosure(model).filter((g) => g.kind !== "dead-actor"), ...preconditionClosure(model).filter((g) => !byVisit(g)), ...referentialClosure(model), ...authorizationClosure(model)];

  const authorBlind: Finding[] = [];
  const writers = new Map<string, Set<string>>();
  const values = new Map<string, Set<string>>();
  const moves = new Map<string, number>();
  const refusals = new Map<string, number>();

  for (const s of toldOf(stories)) {
    const w = writeOf(s);
    for (const op of (s.cannot && w?.ops) || []) {
      const entity = entityOf(locate(w!.doc, op.path).chain);
      refusals.set(entity, (refusals.get(entity) ?? 0) + 1);
    }
    if (!s.does || !w || w.doc === reading.session) continue;
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

  const count = (kind: "does" | "cannot" | "closesTab" | "opensTab") => toldOf(stories).filter((s) => s[kind] !== undefined).length;
  return {
    reading,
    report: {
      counts: {
        stories: toldOf(stories).length,
        does: count("does"),
        cannot: count("cannot"),
        closesTab: count("closesTab"),
        opensTab: count("opensTab"),
        actors: model.actors.length,
        entities: model.entities.length,
        fields: model.entities.reduce((n, e) => n + e.fields.length, 0),
      },
      gaps,
      story: { authorBlind, manyWriters, states, refusals },
      notes: reading.notes,
    },
  };
}

export function format(name: string, report: Report): string {
  const c = report.counts;
  const lines: string[] = [];
  const out = (s = "") => lines.push(s);
  out(`# ${name}: closure over stories`);
  out();
  out(`${c.stories} stories (${c.does} does, ${c.cannot} cannot${c.closesTab ? `, ${c.closesTab} closes a tab` : ""}${c.opensTab ? `, ${c.opensTab} opens a tab` : ""}) · ${c.actors} actors · ${c.entities} entities · ${c.fields} fields`);
  out();
  out(`## hjeli's predicates`);
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
  return lines.join("\n");
}

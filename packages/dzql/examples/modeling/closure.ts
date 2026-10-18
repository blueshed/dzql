// hjeli's six registers, run on the model as it is told: after every change, over the stories and
// documents the page keeps, the same six questions hjeli asked of its model (hjeli's README, and
// its predicates, copied at ./loader/model/predicates.ts) -- each in the words the page has. Pure:
// the page draws them as a part the server sends again with every change (./page.ts), and the CLI's
// `show` prints them (./cli.ts).
//
//   reachability            every entity is held by some document, and every document by someone
//   subscription closure    every write a story makes reaches a document someone holds
//   actor closure           every actor is someone a story knows: whoever holds a document tells a story
//   precondition closure    every row a write changes is added by some story (or made by the visit: an
//                           own document's root), and every state a story requires some write sets --
//                           asked of the stories that say what they write (`writes`, `requires`)
//   referential closure     every name resolves: a story a document serves, what an entity hangs under, names
//   authorization closure   every write is the writer's to make: what a story touches, its teller holds
//
// A register that the model cannot answer says so, and is never counted as passed.

import { esc } from "dzql/rendering/html";
import { saidWrite, touched, type Raw, type StoryWrite } from "./heart";

export type Register = {
  predicate: "reachability" | "subscription-closure" | "actor-closure" | "precondition-closure" | "referential-closure" | "authorization-closure";
  /** What hjeli's predicate asks, as the page can ask it. */
  asks: string;
  /** Where the model does not say what the register needs: the register is not asked, and counts as nothing. */
  notAsked?: string;
  gaps: { kind: string; where: string; detail: string }[];
};

/** A name delta's schema can take, as `dzql model export` writes it: a table's or a column's (hjeli's `SQL_IDENT`). */
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const byId = (a: { id: string | number }, b: { id: string | number }) => Number(a.id) - Number(b.id);

/** The six registers over the model document as delta keeps it. */
export function closureOf(raw: Raw): Register[] {
  const stories = Object.values(raw.stories ?? {}).sort(byId);
  const docs = Object.values(raw.documents ?? {})
    .sort(byId)
    .map((d) => ({ ...d, holds: d.holds ?? {}, held_by: d.held_by ?? [], serves: (d.stories ?? []).map(String) }));
  const tellers = new Set(stories.map((s) => s.actor));
  const heldIn = (entity: string) => docs.filter((d) => entity in d.holds);
  const someoneHolds = (d: (typeof docs)[number]) => d.held_by.length > 0 || !!d.own;
  const doing = stories.filter((s) => s.kind !== "cannot" && !s.post);
  const writes = doing.flatMap((s) => touched(s).map((entity) => ({ s, entity })));
  const said = doing.flatMap((s) => (s.writes ?? []).map((w) => ({ s, w })));
  const story = (s: (typeof stories)[number]) => `story ${s.id} (${s.actor})`;

  const entities = new Set([...docs.flatMap((d) => Object.keys(d.holds)), ...stories.flatMap((s) => touched(s))]);

  const reachability: Register = {
    predicate: "reachability",
    asks: "every entity is held by some document, and every document by someone",
    gaps: [
      ...[...entities].filter((e) => heldIn(e).length === 0).map((e) => ({ kind: "unwatched-entity", where: e, detail: `no document holds ${e}, so nobody is told when it changes` })),
      ...docs.filter((d) => !someoneHolds(d)).map((d) => ({ kind: "unheld-document", where: d.name, detail: `${d.name} is held by nobody, and is not each person's own` })),
    ],
  };

  const subscription: Register = {
    predicate: "subscription-closure",
    asks: "every write a story makes reaches a document someone holds",
    gaps: writes
      .filter(({ entity }) => !heldIn(entity).some(someoneHolds))
      .map(({ s, entity }) => ({ kind: "silent-write", where: story(s), detail: `it touches ${entity}, which reaches no document anyone holds` })),
  };

  const actor: Register = {
    predicate: "actor-closure",
    asks: "every actor is someone a story knows: whoever holds a document tells a story",
    gaps: docs.flatMap((d) =>
      d.held_by.filter((who) => !tellers.has(who)).map((who) => ({ kind: "unknown-holder", where: d.name, detail: `${d.name} is held by ${who}, who tells no story` })),
    ),
  };

  const byVisit = new Set(docs.filter((d) => d.own).map((d) => d.root));
  const added = new Set(said.filter(({ w }) => w.op === "add").map(({ w }) => w.entity));
  const produced = new Set(said.filter(({ w }) => w.path && w.to !== undefined).map(({ w }) => `${w.entity}.${w.path}=${w.to}`));
  const asked = said.length > 0 || stories.some((s) => (s.requires ?? []).length > 0);
  const precondition: Register = {
    predicate: "precondition-closure",
    asks: "every row a write presupposes is added by some story, and every state a story requires some write sets",
    ...(!asked && { notAsked: "no story says what it writes or what it presupposes (writes, requires)" }),
    gaps: [
      ...said
        .filter(({ w }) => w.op !== "add" && !added.has(w.entity) && !byVisit.has(w.entity))
        .map(({ s, w }: { s: (typeof stories)[number]; w: StoryWrite }) => ({ kind: "unestablished-row", where: story(s), detail: `${saidWrite(w)} presupposes a ${w.entity} row, but no story adds one` })),
      ...stories.flatMap((s) =>
        (s.requires ?? [])
          .filter((r) => !produced.has(`${r.entity}.${r.path}=${r.value}`))
          .map((r) => ({ kind: "unreachable-precondition", where: story(s), detail: `it presupposes ${r.entity}.${r.path}=${r.value}, but no write sets it` })),
      ),
    ],
  };

  const told = new Set(stories.map((s) => String(s.id)));
  const seen = new Set<string>();
  const referential: Register = {
    predicate: "referential-closure",
    asks: "every name resolves: the stories a document serves, what each entity hangs under, names a schema can take",
    gaps: [
      ...docs.flatMap((d) => d.serves.filter((id) => !told.has(id)).map((id) => ({ kind: "unknown-story", where: d.name, detail: `${d.name} serves story ${id}, which is not told` }))),
      ...docs.flatMap((d) =>
        Object.entries(d.holds)
          .filter(([e, h]) => e !== d.root && h.parent && !(h.parent in d.holds))
          .map(([e, h]) => ({ kind: "unknown-parent", where: d.name, detail: `${e} hangs under ${h.parent}, which ${d.name} does not hold` })),
      ),
      ...[...entities].filter((e) => !IDENT.test(e)).map((e) => ({ kind: "invalid-name", where: e, detail: `${JSON.stringify(e)} is not a name a table can take` })),
      ...docs.flatMap((d) =>
        Object.entries(d.holds).flatMap(([e, h]) =>
          (h.fields ?? []).filter((f) => !IDENT.test(f.name)).map((f) => ({ kind: "invalid-name", where: `${d.name}: ${e}`, detail: `${JSON.stringify(f.name)} is not a name a column can take` })),
        ),
      ),
      ...docs.filter((d) => (seen.has(d.name) ? true : (seen.add(d.name), false))).map((d) => ({ kind: "duplicate-name", where: d.name, detail: `more than one document is named ${d.name}` })),
    ],
  };

  const authorization: Register = {
    predicate: "authorization-closure",
    asks: "every write is the writer's to make: what a story touches, its teller holds (you may write what you may read)",
    gaps: writes
      .filter(({ s, entity }) => heldIn(entity).length > 0 && !heldIn(entity).some((d) => d.held_by.includes(s.actor) || !!d.own))
      .map(({ s, entity }) => ({ kind: "unscoped-write", where: story(s), detail: `${s.actor} touches ${entity}, held by no document ${s.actor} holds` })),
  };

  return [reachability, subscription, actor, precondition, referential, authorization];
}

const NAMES: Record<Register["predicate"], string> = {
  reachability: "Reachability",
  "subscription-closure": "Subscription closure",
  "actor-closure": "Actor closure",
  "precondition-closure": "Precondition closure",
  "referential-closure": "Referential closure",
  "authorization-closure": "Authorization closure",
};

const count = (r: Register) => (r.notAsked ? "not asked" : r.gaps.length === 0 ? "closed" : `${r.gaps.length} gap${r.gaps.length === 1 ? "" : "s"}`);

/** The registers across the top of the page: each its name and what it found, opened to its gaps. */
export function drawClosure(registers: Register[]): string {
  const open = registers.reduce((n, r) => n + r.gaps.length, 0);
  const one = (r: Register) => {
    const state = r.notAsked ? "unasked" : r.gaps.length ? "open" : "closed";
    const body = r.notAsked
      ? `<p>Not asked: ${esc(r.notAsked)}.</p>`
      : r.gaps.length
        ? `<ul>${r.gaps.map((g) => `<li><b>${esc(g.where)}</b> ${esc(g.detail)}</li>`).join("")}</ul>`
        : `<p>Every one: ${esc(r.asks)}.</p>`;
    return `<details class="register ${state}" data-predicate="${r.predicate}"><summary><span class="dot"></span>${esc(NAMES[r.predicate])} · ${esc(count(r))}</summary><div class="register-body"><p class="asks">${esc(r.asks)}</p>${body}</div></details>`;
  };
  return `<section id="closure" aria-label="hjeli's six registers: ${open} gap${open === 1 ? "" : "s"}">${registers.map(one).join("")}</section>`;
}

/** The registers in plain text, for the CLI's `show`. */
export function plainClosure(registers: Register[]): string {
  return ["Closure (hjeli's six registers)", ...registers.flatMap((r) => [`${NAMES[r.predicate]}: ${count(r)}${r.notAsked ? ` (${r.notAsked})` : ""}`, ...r.gaps.map((g) => `  ${g.kind} · ${g.where}: ${g.detail}`)])].join("\n");
}

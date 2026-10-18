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
import { knownType, parentIn } from "dzql/modelling/definitions";
import { saidWrite, touched, type Raw, type StoryWrite } from "./heart";

export type Register = {
  predicate: "reachability" | "subscription-closure" | "actor-closure" | "precondition-closure" | "referential-closure" | "authorization-closure" | "coverage" | "playability";
  /** What hjeli's predicate asks, as the page can ask it. */
  asks: string;
  /** Where the model does not say what the register needs: the register is not asked, and counts as nothing. */
  notAsked?: string;
  gaps: { kind: string; where: string; detail: string }[];
  /** Findings worth reading that do not hold the model open (derive-ux's advisories): shown, never counted. */
  advice?: { kind: string; where: string; detail: string }[];
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
  // where each entity hangs, as each document says it (a root says nothing): one table has one parent
  const parents = new Map<string, Map<string, string[]>>();
  for (const d of docs)
    for (const [e, h] of Object.entries(d.holds)) {
      const p = parentIn(d, e, h);
      if (p) parents.set(e, (parents.get(e) ?? new Map()).set(p, [...(parents.get(e)?.get(p) ?? []), d.name]));
    }
  const parentOf = (e: string) => [...(parents.get(e)?.keys() ?? [])][0];
  const fieldsOf = (e: string) => new Set(heldIn(e).flatMap((d) => (d.holds[e]?.fields ?? []).map((f) => f.name)));
  const impliedRoots = new Set(docs.filter((d) => !parentOf(d.root)).map((d) => d.root));

  const reachability: Register = {
    predicate: "reachability",
    asks: "every entity is held by some document, and every document by someone",
    gaps: [
      ...[...entities].filter((e) => heldIn(e).length === 0).map((e) => ({ kind: "unwatched-entity", where: e, detail: `no document holds ${e}, so nobody is told when it changes` })),
      ...docs.filter((d) => !someoneHolds(d)).map((d) => ({ kind: "unheld-document", where: d.name, detail: `${d.name} is held by nobody, and is not each person's own` })),
      // a document with no field anywhere in it shows nobody anything: an empty model is never "closed"
      ...docs.filter((d) => !d.own && Object.values(d.holds).every((h) => !(h.fields ?? []).length)).map((d) => ({ kind: "empty-document", where: d.name, detail: `${d.name} holds no field: say what it holds (holds <document> <entity> <field>...)` })),
      // asked once stories say what they write: an entity held and read, which no story ever writes, is always empty
      ...(said.length === 0
        ? []
        : [...entities]
            // an implied root with no fields is there before any write makes it: nothing of it is ever empty
            .filter((e) => heldIn(e).length > 0 && !said.some(({ w }) => w.entity === e) && !docs.some((d) => d.own && d.root === e) && !(impliedRoots.has(e) && fieldsOf(e).size === 0))
            .map((e) => ({ kind: "unwritten-entity", where: e, detail: `${heldIn(e).map((d) => d.name).join(", ")} hold${heldIn(e).length === 1 ? "s" : ""} ${e}, but no story ever writes one` }))),
    ],
  };

  const subscription: Register = {
    predicate: "subscription-closure",
    asks: "every write a story makes reaches a document someone holds",
    gaps: [
      // a story that says neither what it changes nor what it reads tells nobody anything
      ...doing.filter((s) => touched(s).length === 0).map((s) => ({ kind: "silent-story", where: story(s), detail: `it says nothing it writes or reads: say its writes (writes <story> add <entity>...) or what it touches` })),
      ...writes
        .filter(({ entity }) => !heldIn(entity).some(someoneHolds))
        .map(({ s, entity }) => ({ kind: "silent-write", where: story(s), detail: `it touches ${entity}, which reaches no document anyone holds` })),
      // hjeli's field level: a write to a field reaches a holder only if some document holds that field
      ...said
        .filter(({ w }) => w.path && heldIn(w.entity).length > 0 && !fieldsOf(w.entity).has(w.path))
        .map(({ s, w }) => ({ kind: "unwatched-field", where: story(s), detail: `${saidWrite(w)} sets ${w.entity}.${w.path}, which no document holds` })),
    ],
  };

  const actor: Register = {
    predicate: "actor-closure",
    asks: "every actor is someone a story knows, and has something in front of them: whoever holds a document tells a story, whoever tells a story holds a document",
    gaps: [
      ...docs.flatMap((d) =>
        d.held_by.filter((who) => !tellers.has(who)).map((who) => ({ kind: "unknown-holder", where: d.name, detail: `${d.name} is held by ${who}, who tells no story` })),
      ),
      // hjeli's: every actor has something in front of them -- a teller who holds no document acts blind
      ...[...new Set(doing.map((s) => s.actor))]
        .filter((who) => docs.length > 0 && !docs.some((d) => d.held_by.includes(who) || (d.own && d.serves.some((id) => stories.find((x) => String(x.id) === id)?.actor === who))))
        .map((who) => ({ kind: "nothing-in-front", where: who, detail: `${who} tells a story and holds no document: what do they need in front of them? (heldby <document> ${who})` })),
    ],
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
      // a row added under a parent presupposes the parent's row: added by a story, made by the visit, or a document's implied root
      ...said
        .filter(({ w }) => w.op === "add" && parentOf(w.entity) && !added.has(parentOf(w.entity)!) && !byVisit.has(parentOf(w.entity)!) && !impliedRoots.has(parentOf(w.entity)!))
        .map(({ s, w }) => ({ kind: "unestablished-parent", where: story(s), detail: `${saidWrite(w)} adds under a ${parentOf(w.entity)} row, but no story adds one` })),
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
      ...[...parents]
        .filter(([, by]) => by.size > 1)
        .map(([e, by]) => ({ kind: "parent-clash", where: e, detail: `one table hangs from one parent, but ${[...by].map(([p, ds]) => `${ds.join(", ")} put${ds.length === 1 ? "s" : ""} ${e} under ${p}`).join(" and ")}` })),
      ...docs.flatMap((d) =>
        Object.entries(d.holds).flatMap(([e, h]) =>
          (h.fields ?? []).filter((f) => !knownType(f.type)).map((f) => ({ kind: "unknown-type", where: `${d.name}: ${e}.${f.name}`, detail: `${JSON.stringify(f.type)} is not a type the model knows (text, integer, real, boolean, json, timestamptz, date)` })),
        ),
      ),
    ],
  };

  const authorization: Register = {
    predicate: "authorization-closure",
    asks: "every write is the writer's to make: what a story touches, its teller holds (you may write what you may read)",
    gaps: writes
      .filter(({ s, entity }) => heldIn(entity).length > 0 && !heldIn(entity).some((d) => d.held_by.includes(s.actor) || !!d.own))
      .map(({ s, entity }) => ({ kind: "unscoped-write", where: story(s), detail: `${s.actor} touches ${entity}, held by no document ${s.actor} holds` })),
  };

  // Easy's coverage (Simple's modeller): every write has been decided for everyone it could reach. Easy
  // kept can and denied per actor and method; here a person who holds what a story writes either tells
  // a story that writes it too, or a `cannot` story that is refused it -- else what the app's permit
  // says for them is a guess. (Easy's "confirmed at the API, at the UX" is proved, not ticked: the
  // generated model.test.ts on a store, the stories over the wire, and by hand in a browser.)
  const refused = stories.filter((s) => s.kind === "cannot");
  const decided = (who: string, w: StoryWrite) =>
    [...doing, ...refused].some((s) => s.actor === who && (s.writes ?? []).some((x) => x.entity === w.entity && x.op === w.op && (x.path ?? "") === (w.path ?? "")));
  const writers = new Map<string, { w: StoryWrite; holders: Set<string> }>();
  for (const { w } of said) {
    const key = `${w.op} ${w.entity}${w.path ? `.${w.path}` : ""}`;
    const holders = new Set(heldIn(w.entity).filter((d) => !d.own && (!w.path || (d.holds[w.entity]?.fields ?? []).some((f) => f.name === w.path))).flatMap((d) => d.held_by));
    writers.set(key, { w, holders });
  }
  const coverage: Register = {
    predicate: "coverage",
    asks: "every write is decided for everyone who holds what it changes: a story where they make it, or one where they are refused",
    ...(!said.length && { notAsked: "no story says what it writes (writes)" }),
    gaps: [...writers].flatMap(([key, { w, holders }]) =>
      [...holders].filter((who) => !decided(who, w)).map((who) => ({ kind: "undecided-write", where: key, detail: `${who} holds it, and no story says whether ${who} may ${key}` })),
    ),
  };

  // Playability (rights' derive-ux.ts): can each person take their turn? A turn is a state a story
  // waits on; a wait is a state a person makes that someone else's story waits on.
  const shows = (who: string, entity: string, path: string) => docs.some((d) => d.held_by.includes(who) && (d.holds[entity]?.fields ?? []).some((f) => f.name === path));
  const consumers = (k: string) => stories.filter((s) => s.kind !== "cannot" && (s.requires ?? []).some((r) => `${r.entity}.${r.path}=${r.value}` === k));
  const playability: Register = {
    predicate: "playability",
    asks: "every person can see it is their move, and see what they wait on",
    ...(!asked && { notAsked: "no story says what it writes or what it presupposes (writes, requires)" }),
    gaps: [
      ...stories.flatMap((s) =>
        (s.requires ?? []).filter((r) => !shows(s.actor, r.entity, r.path)).map((r) => ({ kind: "blind-turn", where: story(s), detail: `it is ${s.actor}'s move once ${r.entity}.${r.path}=${r.value}, but no document ${s.actor} holds shows ${r.entity}.${r.path}` })),
      ),
      ...said
        .filter(({ s, w }) => w.path && w.to !== undefined && consumers(`${w.entity}.${w.path}=${w.to}`).some((o) => o.actor !== s.actor) && !shows(s.actor, w.entity, w.path))
        .map(({ s, w }) => ({ kind: "blind-wait", where: story(s), detail: `${s.actor} sets ${w.entity}.${w.path}=${w.to} and waits on someone else, but holds no document that shows ${w.entity}.${w.path}` })),
    ],
    advice: [
      // a state another person moves on, with one way out: no decline, no reject
      ...[...produced].flatMap((k) => {
        const out = consumers(k);
        return out.length === 1 ? [{ kind: "single-exit", where: k, detail: `${k} has one way on (${out[0]!.actor}: "${out[0]!.text}"), and no way to say no` }] : [];
      }),
      // a state made that no story moves on from: an end, or a story missing
      ...[...produced].filter((k) => consumers(k).length === 0).map((k) => ({ kind: "terminal-state", where: k, detail: `${k} is made, and no story moves on from it: an end, or a story not yet told` })),
      // a field set when its row is made, which no story ever changes
      ...[...entities].flatMap((e) =>
        [...fieldsOf(e)].filter((f) => !said.some(({ w }) => w.entity === e && w.op === "replace" && w.path === f)).map((f) => ({ kind: "uneditable-field", where: `${e}.${f}`, detail: `no story changes ${e}.${f} once its row is made` })),
      ),
    ],
  };

  const all = [reachability, subscription, actor, precondition, referential, authorization, coverage, playability];
  // nothing told is nothing checked: an empty model is never shown as closed
  return stories.length ? all : all.map((r) => (r.gaps.length ? r : { ...r, notAsked: "no story is told yet" }));
}

const NAMES: Record<Register["predicate"], string> = {
  reachability: "Reachability",
  "subscription-closure": "Subscription closure",
  "actor-closure": "Actor closure",
  "precondition-closure": "Precondition closure",
  "referential-closure": "Referential closure",
  "authorization-closure": "Authorization closure",
  coverage: "Coverage",
  playability: "Playability",
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
    const advice = r.advice?.length ? `<ul class="advice">${r.advice.map((g) => `<li><b>${esc(g.where)}</b> ${esc(g.detail)}</li>`).join("")}</ul>` : "";
    return `<details class="register ${state}" data-predicate="${r.predicate}"><summary><span class="dot"></span>${esc(NAMES[r.predicate])} · ${esc(count(r))}</summary><div class="register-body"><p class="asks">${esc(r.asks)}</p>${body}${advice}</div></details>`;
  };
  return `<section id="closure" aria-label="the model's checks: ${open} gap${open === 1 ? "" : "s"}">${registers.map(one).join("")}</section>`;
}

/** The registers in plain text, for the CLI's `show`. */
export function plainClosure(registers: Register[]): string {
  return ["Checks (hjeli's six, Easy's coverage, derive-ux's playability)", ...registers.flatMap((r) => [`${NAMES[r.predicate]}: ${count(r)}${r.notAsked ? ` (${r.notAsked})` : ""}`, ...r.gaps.map((g) => `  ${g.kind} · ${g.where}: ${g.detail}`), ...(r.notAsked ? [] : r.advice ?? []).map((g) => `  advice: ${g.kind} · ${g.where}: ${g.detail}`)])].join("\n");
}

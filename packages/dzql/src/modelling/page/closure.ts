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
import { knownType, readingOf, refOf, typeOf } from "dzql/modelling/reading";
import { saidWrite, singular, touched, type Raw, type StoryWrite } from "./heart";

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
  // the model read once, as the proof and the guards read it (dzql/modelling/reading)
  const m = readingOf(raw);
  const { stories, documents: docs, parentOf, above, heldIn } = m;
  const tellers = new Set(stories.map((s) => s.actor));
  const someoneHolds = (d: (typeof docs)[number]) => d.held_by.length > 0 || !!d.own;
  const doing = stories.filter((s) => s.kind !== "cannot" && !s.post);
  const writes = doing.flatMap((s) => touched(s).map((entity) => ({ s, entity })));
  const said = doing.flatMap((s) => (s.writes ?? []).map((w) => ({ s, w })));
  const story = (s: (typeof stories)[number]) => `story ${s.id} (${s.actor})`;

  const entities = new Set([...docs.flatMap((d) => Object.keys(d.holds)), ...stories.flatMap((s) => touched(s))]);
  const fieldsOf = (e: string) => new Set(heldIn(e).flatMap((d) => (d.holds[e]?.fields ?? []).map((f) => f.name)));
  // whose copy a role holds is said when their own document holds a field naming it, or a row it
  // hangs under: a seat's `table` says which table's invoice is theirs (cafe-c's feedback)
  const ownSays = (who: string, root: string): boolean => {
    // a ref says it outright (the visit's `table: door:/tables`); a field named for one, the older way
    const chain = new Set(above(root));
    const names = new Set([...chain].flatMap((e) => [e, singular(e)].flatMap((n) => [n, `${n}_id`])));
    return m.inFront(who).some((o) => o.own && Object.values(o.holds).some((h) => h.fields.some((f) => (refOf(f.type) ? chain.has(refOf(f.type)!.collection) : names.has(f.name)))));
  };
  // each ref a document holds: the field, its entity, the path it names, and whoever holds it there
  const holdersOf = (d: (typeof docs)[number]) => (d.own ? [...new Set(stories.filter((s) => d.serves.includes(String(s.id))).map((s) => s.actor))] : d.held_by);
  const refsHeld = docs.flatMap((d) =>
    Object.entries(d.holds).flatMap(([e, h]) => h.fields.flatMap((f) => (refOf(f.type) ? [{ d, e, label: f.name, ...refOf(f.type)! }] : []))),
  );
  const impliedRoots = new Set(docs.filter((d) => d.implied).map((d) => d.root));

  const reachability: Register = {
    predicate: "reachability",
    asks: "every entity is held by some document, and every document by someone",
    gaps: [
      ...[...entities].filter((e) => heldIn(e).length === 0).map((e) => ({ kind: "unwatched-entity", where: e, detail: `no document holds ${e}, so nobody is told when it changes` })),
      ...docs.filter((d) => !someoneHolds(d)).map((d) => ({ kind: "unheld-document", where: d.name, detail: `${d.name} is held by nobody, and is not each person's own` })),
      // a story no document serves happens in front of nobody (the page's "no document")
      ...stories.filter((s) => !s.post && !docs.some((d) => d.serves.includes(String(s.id)))).map((s) => ({ kind: "unserved-story", where: story(s), detail: `no document serves it: which document is it done on? (serves <document's number> ... ${s.id})` })),
      // a ref names a row of another document: whoever holds it must hold that one too, or it names what they cannot see
      ...refsHeld.flatMap((r) =>
        holdersOf(r.d)
          .filter((who) => docs.some((x) => x.name === r.doc) && !m.inFront(who).some((x) => x.name === r.doc))
          .map((who) => ({ kind: "unseen-ref", where: `${r.d.name}: ${r.e}.${r.label}`, detail: `${who} holds ${r.e}.${r.label}, which names a row of ${r.doc}:/${r.collection}, and does not hold ${r.doc} (heldby ${docs.find((x) => x.name === r.doc)!.id} ... ${who})` })),
      ),
      // a document with no field anywhere in it shows nobody anything: an empty model is never "closed"
      ...docs.filter((d) => !d.own && Object.values(d.holds).every((h) => !(h.fields ?? []).length)).map((d) => ({ kind: "empty-document", where: d.name, detail: `${d.name} holds no field: say what it holds (holds ${d.id} <entity> <field>...)` })),
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
    // a write another person's document holds, which that document does not serve: are they told? (cafe-e's feedback: the customer seeing their table seated)
    advice: said.flatMap(({ s, w }) =>
      docs
        .filter((d) => !d.own && !d.serves.includes(String(s.id)) && d.held_by.some((who) => who !== s.actor) && (d.holds[w.entity]?.fields ?? []).some((f) => !w.path || f.name === w.path))
        .map((d) => ({ kind: "unserved-holder", where: `${story(s)} · ${d.name}`, detail: `${saidWrite(w)} changes what ${d.name} holds, held by ${d.held_by.filter((who) => who !== s.actor).join(", ")}, and ${d.name} does not serve it: are they told? (serves ${d.id} ... ${s.id})` })),
    ),
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
        .filter((who) => m.inFront(who).length === 0)
        .map((who) => ({ kind: "nothing-in-front", where: who, detail: `${who} tells a story and holds no document: what do they need in front of them? (heldby <document's number> ${who})` })),
    ],
    // a document held by a role, whose root is one of many (a story adds them): which one is each person's?
    // a list is every row of its root, the same for everyone who holds it: nobody's copy to say
    advice: docs.flatMap((d) =>
      d.own || d.list || !said.some(({ w }) => w.op === "add" && w.entity === d.root)
        ? []
        : d.held_by.filter((who) => !said.some(({ s, w }) => s.actor === who && w.op === "add" && w.entity === d.root) && !ownSays(who, d.root)).map((who) => ({ kind: "whose-copy", where: `${d.name} (${who})`, detail: `there are many ${d.root}: which one is ${who}'s, and how do they come to hold it? (a story that gives it them, or a document of their own that says)` })),
    ),
  };

  const { added, there } = m;
  const produced = new Set(said.filter(({ w }) => w.path && w.to !== undefined).map(({ w }) => `${w.entity}.${w.path}=${w.to}`));
  const asked = said.length > 0 || stories.some((s) => (s.requires ?? []).length > 0);
  const precondition: Register = {
    predicate: "precondition-closure",
    asks: "every row a write presupposes is added by some story, and every state a story requires some write sets",
    ...(!asked && { notAsked: "no story says what it writes or what it presupposes (writes, requires)" }),
    gaps: [
      ...said
        // an implied root's row is made by its first write, as a visit makes an own document's
        .filter(({ w }) => w.op !== "add" && !added.has(w.entity) && !there(w.entity))
        .map(({ s, w }: { s: (typeof stories)[number]; w: StoryWrite }) => ({ kind: "unestablished-row", where: story(s), detail: `${saidWrite(w)} presupposes a ${w.entity} row, but no story adds one` })),
      // a row added under a parent presupposes the parent's row: added by a story, made by the visit, or a document's implied root
      ...said
        .filter(({ w }) => w.op === "add" && parentOf(w.entity) && !added.has(parentOf(w.entity)!) && !there(parentOf(w.entity)!))
        .map(({ s, w }) => ({ kind: "unestablished-parent", where: story(s), detail: `${saidWrite(w)} adds under a ${parentOf(w.entity)} row, but no story adds one` })),
      // a row a ref names: a new row starts naming one, and a replace of the ref names another
      ...said.flatMap(({ s, w }) =>
        m.refsOf(w.entity)
          .filter((r) => (w.op === "add" || w.path === r.label) && !added.has(r.collection) && !there(r.collection))
          .map((r) => ({ kind: "unestablished-ref", where: story(s), detail: `${saidWrite(w)} names a row of ${r.doc}:/${r.collection} (${w.entity}.${r.label}), but no story adds one` })),
      ),
      ...stories.flatMap((s) =>
        (s.requires ?? [])
          .filter((r) => !produced.has(`${r.entity}.${r.path}=${r.value}`))
          .map((r) => ({ kind: "unreachable-precondition", where: story(s), detail: `it presupposes ${r.entity}.${r.path}=${r.value}, but no write sets it (an add may start it: writes <story> add ${r.entity}.${r.path}=${r.value})` })),
      ),
      // what a story presupposes is read from a row it writes or one above it: else the guards cannot check it
      ...stories.flatMap((s) =>
        (s.requires ?? [])
          .filter((r) => (s.writes ?? []).length > 0 && !(s.writes ?? []).some((w) => m.reach(w.entity).has(r.entity)))
          .map((r) => ({ kind: "unchecked-precondition", where: story(s), detail: `it presupposes ${r.entity}.${r.path}=${r.value}, which none of its writes reaches (a row it writes, one that hangs above it, or one a ref names), so it cannot be checked` })),
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
      // a document's name is its prefix on the wire and its type's name: one word (cafe-c's feedback)
      ...docs.filter((d) => !IDENT.test(d.name)).map((d) => ({ kind: "invalid-name", where: d.name, detail: `${JSON.stringify(d.name)} is not a name a document can take: one word, letters, digits and _ (rename ${d.id} ${d.name.replace(/[^A-Za-z0-9_]+/g, "_")})` })),
      ...docs.flatMap((d) =>
        Object.entries(d.holds).flatMap(([e, h]) =>
          (h.fields ?? []).filter((f) => !IDENT.test(f.name)).map((f) => ({ kind: "invalid-name", where: `${d.name}: ${e}`, detail: `${JSON.stringify(f.name)} is not a name a column can take` })),
        ),
      ),
      // a ref is a path into a list: the row's id its last step, so the document's name is whole without it
      ...refsHeld.flatMap((r) => {
        const target = docs.find((x) => x.name === r.doc);
        const where = `${r.d.name}: ${r.e}.${r.label}`;
        if (!target) return [{ kind: "unknown-ref", where, detail: `${r.e}.${r.label} names a row of ${r.doc}:/${r.collection}, and there is no document ${r.doc}` }];
        if (!(r.collection in target.holds)) return [{ kind: "unknown-ref", where, detail: `${r.e}.${r.label} names a row of ${r.doc}:/${r.collection}, and ${r.doc} holds no ${r.collection}` }];
        if (!target.list) return [{ kind: "unknown-ref", where, detail: `${r.e}.${r.label} names a row of ${r.doc}:/${r.collection}, and ${r.doc} is one ${singular(target.root)}, not a list: a ref names a row of a list (list ${target.id})` }];
        return [];
      }),
      ...docs.filter((d) => (seen.has(d.name) ? true : (seen.add(d.name), false))).map((d) => ({ kind: "duplicate-name", where: d.name, detail: `more than one document is named ${d.name}` })),
      ...m.clashes.map(([e, by]) => ({ kind: "parent-clash", where: e, detail: `one table hangs from one parent, but ${[...by].map(([p, ds]) => `${ds.join(", ")} put${ds.length === 1 ? "s" : ""} ${e} under ${p}`).join(" and ")}` })),
      ...docs.flatMap((d) =>
        Object.entries(d.holds).flatMap(([e, h]) =>
          (h.fields ?? []).filter((f) => !knownType(f.type)).map((f) => ({ kind: "unknown-type", where: `${d.name}: ${e}.${f.name}`, detail: `${JSON.stringify(f.type)} is not a type the model knows (text, integer, real, boolean, json, timestamptz, date, or a ref: a path into a list, menu:/items)` })),
        ),
      ),
    ],
    // every table keeps its history, so the row a ref names is there as it stood: a row that names
    // one and says when (a time) can be read with the dish as it was then, its price that day
    advice: [...new Map(refsHeld.map((r) => [`${r.e}.${r.label}`, r])).values()]
      .filter((r) => ![...(m.entities.get(r.e)?.fields.values() ?? [])].some((t) => typeOf(t) === "timestamptz"))
      .map((r) => ({ kind: "undated-ref", where: `${r.e}.${r.label}`, detail: `${r.e} names a row of ${r.doc}:/${r.collection} and says no time: give it one (holds ${r.d.id} ${r.e} ... made_at:timestamptz) to read ${r.doc} as it stood then` })),
  };

  const authorization: Register = {
    predicate: "authorization-closure",
    asks: "every write is the writer's to make: what a story touches, its teller holds (you may write what you may read)",
    gaps: writes
      .filter(({ s, entity }) => heldIn(entity).length > 0 && m.writable(s.actor, entity).length === 0)
      .map(({ s, entity }) => ({ kind: "unscoped-write", where: story(s), detail: `${s.actor} touches ${entity}, held by no document ${s.actor} holds` })),
  };

  // Easy's coverage (Simple's modeller): every write has been decided for everyone it could reach. Easy
  // kept can and denied per actor and method; here a person who holds what a story writes either tells
  // a story that writes it too, or a `cannot` story that is refused it -- else what the app's permit
  // says for them is a guess. (Easy's "confirmed at the API, at the UX" is proved, not ticked: the
  // generated model.test.ts on a store, the stories over the wire, and by hand in a browser.)
  const refused = stories.filter((s) => s.kind === "cannot");
  const decided = (who: string, w: StoryWrite) =>
    [...doing, ...refused].some((s) => s.actor === who && (s.writes ?? []).some((x) => x.entity === w.entity && x.op === w.op && ((x.path ?? "") === (w.path ?? "") || (s.kind === "cannot" && !x.path)))); // a cannot with no field refuses every one, as the guards do
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
    gaps: [
      ...[...writers].flatMap(([key, { w, holders }]) =>
        [...holders].filter((who) => !decided(who, w)).map((who) => ({ kind: "undecided-write", where: key, detail: `${who} holds it, and no story says whether ${who} may ${key}` })),
      ),
      // a cannot the same teller's does already lets through, presupposing nothing: the guards try
      // the does first, so the cannot never refuses (cafe-c's feedback)
      ...refused.flatMap((c) =>
        (c.writes ?? []).flatMap((cw) => {
          const by = doing.find((d) => d.actor === c.actor && !(d.requires ?? []).length && (d.writes ?? []).some((dw) => dw.entity === cw.entity && dw.op === cw.op && (!dw.path || dw.path === cw.path) && (dw.to === undefined || dw.to === cw.to)));
          return by ? [{ kind: "shadowed-cannot", where: story(c), detail: `story ${by.id} already lets ${c.actor} ${saidWrite(cw)}, presupposing nothing, so this is never refused: say what tells them apart (requires ${by.id} ...)` }] : [];
        }),
      ),
    ],
  };

  // Playability (rights' derive-ux.ts): can each person take their turn? A turn is a state a story
  // waits on; a wait is a state a person makes that someone else's story waits on.
  // what is in front of someone: what they hold, and their own document where it serves a story of theirs
  const shows = (who: string, entity: string, path: string) => m.inFront(who).some((d) => (d.holds[entity]?.fields ?? []).some((f) => f.name === path));
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

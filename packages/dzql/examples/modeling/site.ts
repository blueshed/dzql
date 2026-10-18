// The model read back for a customer, as hjeli's `export site` had it: one static page, no scripts,
// that scrolls because it is a document. The page the modeller keeps (./page.ts) is the AI's and
// the modeller's, live; this is for the person who asked for the app, regenerated between turns of
// the conversation (`dzql model site`): a chapter per person, their stories, what each write does and
// what it waits on, the documents in front of them, then where the model stands (hjeli's six
// registers) and, as an appendix, the records. The records' tree is plain HTML, and the same as
// mermaid source in a fold-out, which a host that draws mermaid (GitHub, an artifact) draws.

import { esc } from "dzql/rendering/html";
import { closureOf, type Register } from "./closure";
import { heartOf, list, singular, type Raw, type Requires, type StoryWrite } from "./heart";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const words = (s: string) => s.replace(/_id$/, "").replace(/[-_]/g, " ");
const one = (entity: string) => words(singular(entity));
const a = (s: string) => `${/^[aeiou]/i.test(s) ? "an" : "a"} ${s}`;

/** A write, as someone reads it: "adds a request, its status waiting". */
export function writeSentence(w: StoryWrite): string {
  const e = one(w.entity);
  if (w.op === "add") return `adds ${a(e)}${w.path ? `, its ${words(w.path)} ${w.to !== undefined ? `“${w.to}”` : "said"}` : ""}`;
  if (w.op === "remove") return `takes ${a(e)} away`;
  if (w.path) return `sets ${a(e)}’s ${words(w.path)}${w.to !== undefined ? ` to “${w.to}”` : ""}`;
  return `changes ${a(e)}`;
}

/** What a story waits on, as someone reads it: "only while the team’s open is “yes”". */
export const requireSentence = (r: Requires) => `only while the ${one(r.entity)}’s ${words(r.path)} is “${r.value}”`;

const NAMES: Record<Register["predicate"], [string, string]> = {
  reachability: ["Everything is seen", "every record is on a page someone has in front of them"],
  "subscription-closure": ["Every change is told", "whatever someone does reaches a page someone holds"],
  "actor-closure": ["Everyone is known", "whoever has a page in front of them has a story"],
  "precondition-closure": ["Everything can happen", "whatever a story waits on, another story brings about"],
  "referential-closure": ["Every name means something", "nothing names what isn’t there"],
  "authorization-closure": ["Everyone may do what they do", "what a person changes is on a page they hold"],
  coverage: ["Who may, and who may not", "for each change, everyone who could see it is either allowed or refused it"],
  playability: ["Everyone can take their turn", "whoever’s move it is can see it, and can see what they wait on"],
};

/** The site: one HTML file, its styles inline, no scripts. `made` says when, so the same model makes the same page. */
export function siteOf(raw: Raw, made = new Date().toISOString().slice(0, 10)): string {
  const name = raw.models.name;
  const h = heartOf(raw);
  const stories = Object.values(raw.stories ?? {}).sort((x, y) => Number(x.id) - Number(y.id));
  const docs = Object.values(raw.documents ?? {}).sort((x, y) => Number(x.id) - Number(y.id));
  const registers = closureOf(raw);
  const actors = [...new Set([...stories.map((s) => s.actor), ...docs.flatMap((d) => d.held_by ?? [])])];
  const docOf = new Map(h.documents.map((d, i) => [docs[i]!.name, d]));
  const anchor = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "-");

  const carded = new Set<string>(); // a document in front of two people is drawn for each; the chips link to the first
  const docCard = (d: (typeof docs)[number]) => {
    const kids = Object.keys(d.holds ?? {}).filter((e) => e !== d.root);
    const what = `${d.own ? `Your own ${one(d.root)}` : `One ${one(d.root)}`}${kids.length ? `, with its ${list(kids.map(words))}` : ""}.`;
    const tree = docOf.get(d.name)!.shape.slice(1).map((l) => {
      const fields = (d.holds?.[l.text]?.fields ?? []).map((f) => f.name);
      return `<li style="margin-left:${l.pad}px"><b>${esc(words(l.text))}</b>${fields.length ? ` <span class="muted">${esc(fields.map(words).join(", "))}</span>` : ""}</li>`;
    });
    return `<article class="card"${carded.has(d.name) ? "" : (carded.add(d.name), ` id="doc-${anchor(d.name)}"`)}><h4>${esc(cap(words(d.name)))}</h4><p>${esc(what)}</p><details><summary>What’s on it</summary><ul class="tree">${tree.join("")}</ul></details></article>`;
  };

  const storyItem = (s: (typeof stories)[number]) => {
    const on = docs.filter((d) => (d.stories ?? []).map(String).includes(String(s.id)));
    const rules = [...(s.writes ?? []).map(writeSentence), ...(s.requires ?? []).map(requireSentence)];
    return `<li class="story${s.kind === "cannot" ? " cannot" : ""}"><span>${esc(cap(s.text))}.</span>${rules.length ? `<span class="rules">${esc(cap(rules.join("; ")))}.</span>` : ""}${on.length ? `<span class="chips">${on.map((d) => `<a class="chip" href="#doc-${anchor(d.name)}">${esc(words(d.name))}</a>`).join("")}</span>` : ""}</li>`;
  };

  const chapters = actors.map((actor) => {
    const does = stories.filter((s) => s.actor === actor && s.kind !== "cannot");
    const cannot = stories.filter((s) => s.actor === actor && s.kind === "cannot");
    const holds = docs.filter((d) => (d.held_by ?? []).includes(actor));
    return `<section class="chapter" id="who-${anchor(actor)}"><h2>${esc(cap(actor))}</h2>
${does.length ? `<h3>What ${esc(actor)} does</h3><ol class="stories">${does.map(storyItem).join("")}</ol>` : ""}
${cannot.length ? `<h3>What ${esc(actor)} cannot do</h3><ol class="stories">${cannot.map(storyItem).join("")}</ol>` : ""}
${holds.length ? `<h3>In front of ${esc(actor)}</h3><div class="cards">${holds.map(docCard).join("")}</div>` : `<p class="muted">Nothing is in front of ${esc(actor)} yet.</p>`}</section>`;
  });

  const own = docs.filter((d) => d.own);
  const open = registers.reduce((n, r) => n + r.gaps.length, 0);
  const standing = registers.map((r) => {
    const [title, means] = NAMES[r.predicate];
    const state = r.notAsked ? "unasked" : r.gaps.length ? "open" : "closed";
    const said = r.notAsked ? "Not asked yet: the stories don’t say what they change." : r.gaps.length ? `<ul>${r.gaps.map((g) => `<li>${esc(g.detail)}</li>`).join("")}</ul>` : "Yes.";
    return `<li class="register ${state}"><b>${esc(title)}</b> <span class="muted">${esc(means)}</span><div>${said}</div></li>`;
  });

  const records = h.entities.map((e) => `<li><b>${esc(words(e.name))}</b>${e.parent ? ` <span class="muted">under ${esc(words(e.parent))}</span>` : ""}${e.columns.length ? `: ${esc(e.columns.map(words).join(", "))}` : ""}</li>`);
  const mermaid = ["erDiagram", ...h.entities.filter((e) => e.parent).map((e) => `  ${e.parent} ||--o{ ${e.name} : has`), ...h.entities.filter((e) => !e.parent && !h.entities.some((x) => x.parent === e.name)).map((e) => `  ${e.name}`)].join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(cap(name))}, in stories</title>
<style>
:root { --bg: #fbfaf7; --ink: #1f2328; --muted: #6a737d; --line: #e4e1da; --card: #ffffff; --accent: #2f6f4f; --warn: #a1462a; --soft: #f1efe9; }
@media (prefers-color-scheme: dark) { :root { --bg: #161a1d; --ink: #e6e6e3; --muted: #9aa3ab; --line: #2c3237; --card: #1d2226; --accent: #7fc4a0; --warn: #e48f6f; --soft: #22282c; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 30px; margin: 0 0 6px; } h2 { margin: 40px 0 8px; padding-top: 16px; border-top: 1px solid var(--line); } h3 { font-size: 15px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 20px 0 8px; } h4 { margin: 0 0 4px; }
.muted { color: var(--muted); } a { color: var(--accent); }
nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; } nav a { text-decoration: none; padding: 2px 10px; border: 1px solid var(--line); border-radius: 999px; }
ol.stories { padding-left: 22px; } .story { margin: 0 0 10px; } .story > span { display: block; } .story.cannot > span:first-child { color: var(--warn); }
.rules { color: var(--muted); font-size: 14px; } .chips { display: flex; gap: 6px; margin-top: 2px; } .chip { font-size: 13px; background: var(--soft); border-radius: 6px; padding: 0 6px; text-decoration: none; }
.cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); } .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; } .card p { margin: 0 0 6px; }
ul.tree, ul.records { list-style: none; padding: 0; margin: 6px 0 0; } ul.records li { margin: 4px 0; }
ul.registers { list-style: none; padding: 0; } .register { border-left: 4px solid var(--line); padding: 4px 12px; margin: 8px 0; } .register.closed { border-color: var(--accent); } .register.open { border-color: var(--warn); } .register div { font-size: 14px; } .register ul { margin: 4px 0; padding-left: 18px; }
pre { background: var(--soft); padding: 12px; border-radius: 8px; overflow-x: auto; } footer { margin-top: 48px; font-size: 13px; color: var(--muted); }
</style>
</head>
<body>
<main>
<h1>${esc(cap(name))}, in stories</h1>
<p class="muted">${stories.length} ${stories.length === 1 ? "story" : "stories"}, told by ${actors.length} ${actors.length === 1 ? "person" : "people"}, and the ${docs.length} ${docs.length === 1 ? "page" : "pages"} they need. ${open === 0 ? "Every question the model is asked has its answer." : `${open} ${open === 1 ? "question is" : "questions are"} still open: see <a href="#standing">where it stands</a>.`}</p>
<nav>${actors.map((x) => `<a href="#who-${anchor(x)}">${esc(cap(x))}</a>`).join("")}<a href="#standing">Where it stands</a><a href="#records">The records</a></nav>
${chapters.join("\n")}
${own.length ? `<section class="chapter"><h2>Everyone’s own</h2><div class="cards">${own.map(docCard).join("")}</div></section>` : ""}
<section class="chapter" id="standing"><h2>Where it stands</h2><ul class="registers">${standing.join("")}</ul></section>
<section class="chapter" id="records"><h2>The records</h2><p class="muted">What the pages are made from, and what each hangs under.</p><ul class="records">${records.join("")}</ul>
<details><summary>As a diagram (mermaid)</summary><pre class="mermaid">${esc(mermaid)}</pre></details></section>
<footer>Made by <code>dzql model site</code> from the model of ${esc(name)}, ${esc(made)}.</footer>
</main>
</body>
</html>
`;
}

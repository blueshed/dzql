// Builds the design canvas from the mock-up itself, so the two cannot drift: each artboard is
// index.html with styles.css inlined, the lucide marks drawn by the kernel's svg() (the browser
// would have used createIcons), and one state applied -- a compartment opened, a figure chosen,
// the drawer or the modal showing, the filter typed into. Run from the repo root:
//   bun examples/bento/design/build.ts
// then seed and save the canvas with the design skill's helper (see the README).
import * as lucide from "lucide";
import { svg, type IconNode } from "../../../src/icons";

const dir = import.meta.dir;
const html = await Bun.file(`${dir}/../index.html`).text();
const css = await Bun.file(`${dir}/../styles.css`).text();

/** `<i data-lucide="chevron-right">` becomes the outline, as createIcons would draw it. */
function drawIcons(markup: string): string {
  return markup.replace(/<i data-lucide="([a-z0-9-]+)"><\/i>/g, (_, name: string) => {
    const exportName = name.replace(/(^|-)([a-z0-9])/g, (_m, _sep, c: string) => c.toUpperCase());
    const node = (lucide as unknown as Record<string, IconNode>)[exportName];
    if (!node) throw new Error(`no lucide icon for ${name}`);
    return svg(node, { name });
  });
}

/** The page's body, with the states the CSS keys on the body moved to a wrapper the artboard can carry. */
function body(markup: string): string {
  return markup.slice(markup.indexOf("<body>") + "<body>".length, markup.indexOf("<script type=\"module\""));
}

type State = {
  open?: string; // data-cell of the opened compartment
  chosen?: string; // data-site of the chosen figure
  drawer?: { title: string; body: string; carry?: string };
  filter?: { word: string; lit: string[] };
  modal?: string; // the name typed into the modal
};

function apply(markup: string, state: State): string {
  let out = markup;
  const classes: string[] = [];
  if (state.open) {
    out = out.replace(`<section class="cell" data-cell="${state.open}">`, `<section class="cell open" data-cell="${state.open}">`);
    classes.push("windowed");
  }
  if (state.chosen) {
    out = out.replace(new RegExp(`(data-site="${state.chosen}"[^>]*aria-pressed=)"false"`), '$1"true"');
  }
  if (state.drawer) {
    classes.push("panel-on");
    out = out
      .replace('<aside class="panel" id="panel" aria-hidden="true">', '<aside class="panel on" id="panel" aria-hidden="false">')
      .replace('<h3 id="panel-title"></h3>', `<h3 id="panel-title">${state.drawer.title}</h3>`)
      .replace('<div class="panel-body" id="panel-body"></div>', `<div class="panel-body" id="panel-body">${state.drawer.body}</div>`)
      .replace('<div class="panel-foot" id="panel-foot"></div>', `<div class="panel-foot" id="panel-foot">${state.drawer.carry ? `<button type="button" class="carry">${state.drawer.carry}</button>` : ""}</div>`);
  }
  if (state.filter && state.open) {
    const { word, lit } = state.filter;
    // the opened compartment's filter, shown and typed into; what it misses, hushed
    const start = out.indexOf(`data-cell="${state.open}"`);
    const end = out.indexOf("</section>", start);
    let section = out.slice(start, end);
    section = section
      .replace('<div class="filter" hidden>', '<div class="filter">')
      .replace('aria-label="Find a gift" aria-pressed="false"', 'aria-label="Find a gift" aria-pressed="true"')
      .replace(/(<input type="search"[^>]*)>/, `$1 value="${word}">`)
      .replace('<span class="tally"></span>', `<span class="tally">${lit.length} of 5</span>`)
      .replace(/<button type="button" class="row" data-site="([^"]+)"/g, (m, site: string) => (lit.includes(site) ? m : m.replace('class="row"', 'class="row hushed"')));
    out = out.slice(0, start) + section + out.slice(end);
  }
  if (state.modal !== undefined) {
    out = out
      .replace('<dialog class="modal" id="modal">', '<div class="backdrop"></div><dialog class="modal" id="modal" open>')
      .replace('id="modal-name" autocomplete="off" required>', `id="modal-name" autocomplete="off" required value="${state.modal}">`);
  }
  return `<div class="page ${classes.join(" ")}">${out}</div>`;
}

/** The mock-up's stylesheet as the artboard's, with the body states on the wrapper and a backdrop for the open dialog. */
const artboardCss =
  css.replace(/body\.panel-on/g, ".page.panel-on").replace(/body\.windowed/g, ".page.windowed") +
  `
/* the artboard: the page fills the frame; a dialog drawn open needs its own backdrop */
.page { min-height: 100%; }
.backdrop { position: fixed; inset: 0; z-index: 69; background: rgba(30, 36, 48, 0.35); }
dialog[open] { position: fixed; z-index: 70; top: 50%; left: 50%; transform: translate(-50%, -50%); margin: 0; }
`;

function artboard(state: State): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
${artboardCss}
  </style>
</helmet>
${apply(drawIcons(body(html)), state)}
</x-dc>
</body>
</html>
`;
}

const mount = "The Mount Without";
const boards: Record<string, State> = {
  Main: {},
  Map: { open: "stay", chosen: mount, drawer: { title: mount, body: `A line or two about ${mount} would go here: whatever the compartment knows about it.` } },
  Gifts: { open: "gifts", chosen: "Kettle", filter: { word: "ke", lit: ["Kettle"] }, drawer: { title: "Kettle", body: "A line or two about Kettle would go here: whatever the compartment knows about it.", carry: "Claim" } },
  Modal: { open: "gifts", modal: "Bread bin" },
  Answer: { chosen: "Our answer", drawer: { title: "Our answer", body: `<label class="modal-field"><span class="note">Answer</span><div class="choice" role="radiogroup"><button type="button" class="carry" aria-pressed="true">Yes</button><button type="button" class="carry" aria-pressed="false">Maybe</button><button type="button" class="carry" aria-pressed="false">No</button></div></label><label class="modal-field"><span class="note">Words for the couple</span><textarea rows="3">Cannot wait. Ada is vegetarian.</textarea></label>` } },
  Phone: {},
  PhoneMap: { open: "stay", chosen: mount, drawer: { title: mount, body: `A line or two about ${mount} would go here.` } },
};

for (const [name, state] of Object.entries(boards)) await Bun.write(`${dir}/${name}.dc.html`, artboard(state));
console.log(`wrote ${Object.keys(boards).length} artboards`);

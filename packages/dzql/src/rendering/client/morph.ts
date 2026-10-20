// Reconciles `target`'s children against `html` in place, instead of
// replacing them outright. The DOM nodes a person is focused on, has typed
// into, or has scrolled -- survive a render because their elements do,
// as long as this can find them again in the new tree.
//
// The HTML here is always server-authored (nothing on the client mutates
// the DOM except applets, fenced off below), so the long tail of general
// keyed-list reconciliation doesn't apply: children are matched by `id`
// first, then the rest in order by tag (matchInOrder), the same tag reused
// and a different one replaced. That's enough for lists that only grow,
// shrink, or update in place, which is all this app ever renders.
import { drawnOption, radiosOf } from "./form-value";

export type MorphHooks = {
  /** Called when a mounted applet's element is about to be removed. */
  onAppletRemoved?(el: Element): void;
  /** Called when a mounted applet's element survives but its data-props changed: from what it holds (`heldProps`), or else from its attribute. */
  onAppletPropsChanged?(el: Element, props: unknown): void;
  /** The props a mounted applet holds, as JSON, where they are not its attribute's: a watching applet's, patched since its render. */
  heldProps?(el: Element): string | undefined;
  /** Whether someone is pressing this box: its tick is theirs until the click lands. */
  pressed?(el: Element): boolean;
};

function isApplet(el: Element): boolean {
  return el.hasAttribute("data-applet");
}

function sameType(a: ChildNode, b: ChildNode): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (!(a instanceof Element) || !(b instanceof Element)) return true;
  if (a.tagName !== b.tagName) return false;
  // An applet's element is only ever reused for the same applet. Matched positionally with a
  // plain element (or another applet), its hand-managed children -- which the morph never
  // descends into -- would survive under the new element's attributes.
  return a.getAttribute("data-applet") === b.getAttribute("data-applet");
}

function key(node: ChildNode): string | undefined {
  return node instanceof Element && node.id ? node.id : undefined;
}

function morphAttributes(old: Element, next: Element, hooks: MorphHooks): void {
  // a tick not yet drawn, or a box being pressed, is the person's; its tick is set now, so no
  // attribute below moves it (a box nobody has touched follows its `checked` attribute)
  const unsent = old instanceof HTMLInputElement && (old.checked !== old.defaultChecked || hooks.pressed?.(old) === true);
  if (unsent) old.checked = old.checked;
  // and what is typed and not yet drawn, someone in the field or not: it differs from what was drawn into it
  const typing = old instanceof HTMLInputElement && old.value !== old.defaultValue;
  for (const { name } of [...old.attributes]) {
    if (!next.hasAttribute(name)) {
      old.removeAttribute(name);
      showRendered(old, name, unsent, typing);
    }
  }
  for (const { name, value } of [...next.attributes]) {
    if (old.getAttribute(name) !== value) {
      old.setAttribute(name, value);
      showRendered(old, name, unsent, typing);
    }
  }
}

/**
 * A field that holds what was last drawn into it, with nobody in it, shows what was just rendered
 * into it. Once typed in, a field's value no longer follows its `value` attribute (nor a
 * textarea's its text), so after an undo it would go on showing the value undone -- and an
 * editing form, comparing it with what was rendered, would send it again. Only when the render
 * changed it, so an unrelated render keeps what is typed; and never over typing not yet drawn
 * (`typing`: it differs from what was drawn), whether or not someone is still in the field, until
 * it is sent and drawn, or typed back to what was. A box or a radio is a select's kind of field
 * (showChosen): it keeps a tick not yet drawn, and otherwise shows what is drawn, whether or not
 * someone is in it.
 */
function showRendered(el: Element, name: string, unsent: boolean, typing: boolean): void {
  if (!(el instanceof HTMLInputElement)) return;
  if (name === "checked") {
    if (!unsent) el.checked = el.defaultChecked;
  } else if (name === "value" && el !== document.activeElement && !typing) el.value = el.defaultValue;
}

/**
 * Runs a render, then shows each group of radios the choice someone made in it and has not yet seen
 * drawn -- by its value, wherever the radios moved, while the group still offers it -- or else what
 * the group is drawn showing: a select's rule (showChosen), for a group. Neither browser does this:
 * the morph reuses a radio by its place, and a radio drawn ticked takes the tick from its group. A
 * group may span parts, so a render in parts runs whole inside one (app.ts), every op of it.
 */
export function keepingChoices(render: () => void): void {
  const chosen = [...document.querySelectorAll<HTMLInputElement>("input[type=radio]:checked:not([checked])")].filter((r) => r.name !== "");
  const choices = chosen.map((r) => ({ form: r.form, name: r.name, value: r.value }));
  render();
  for (const { form, name, value } of choices) {
    const group = radiosOf(form, name);
    const radio = group.find((r) => r.value === value && !r.matches(":disabled")) ?? group.findLast((r) => r.defaultChecked);
    if (radio && !radio.checked) radio.checked = true;
  }
}

/**
 * A select, after a render, shows the choice someone made and has not yet seen drawn -- by its value,
 * wherever the options moved, while it is still offered -- or else what is drawn now, whether or not
 * they are in it. Neither browser does this: the morph reuses an option by its place, so a choice
 * would slide to whatever value its place now has, and a newly drawn option takes the choice away,
 * except in Chrome from an option someone has chosen before, which then stays chosen however it is drawn.
 */
function showChosen(select: HTMLSelectElement, chosen: string | undefined): void {
  const offered = chosen === undefined ? undefined : [...select.options].find((o) => o.value === chosen && !o.matches(":disabled"));
  const option = offered ?? drawnOption(select);
  if (option && !option.selected) option.selected = true; // one already chosen is left be: an open menu keeps its place
}

// An applet's subtree is the applet's: reconcile the element itself, but
// never descend into its children -- a morph diffing "the new HTML" against
// DOM the applet manages by hand would fight it for its own children.
function morphApplet(old: Element, next: Element, hooks: MorphHooks): void {
  const before = hooks.heldProps?.(old) ?? old.getAttribute("data-props");
  morphAttributes(old, next, hooks);
  const after = old.getAttribute("data-props");
  if (hooks.onAppletPropsChanged && after !== before) {
    hooks.onAppletPropsChanged(old, after ? JSON.parse(after) : undefined);
  }
}

function morphNode(old: ChildNode, next: ChildNode, hooks: MorphHooks): void {
  if (old instanceof Element && next instanceof Element) {
    if (isApplet(old)) {
      morphApplet(old, next, hooks);
      return;
    }
    morphAttributes(old, next, hooks);
    const area = old instanceof HTMLTextAreaElement ? old : undefined;
    const text = area?.defaultValue;
    const typing = area !== undefined && area.value !== text; // typed and not yet drawn, as showRendered keeps
    const select = old instanceof HTMLSelectElement && !old.multiple ? old : undefined; // a multiple select is not a field (app.ts): the browser's alone
    const chosen = select && select.value !== (drawnOption(select)?.value ?? "") ? select.value : undefined; // not yet drawn
    morphChildren(old, next, hooks);
    if (area && area.defaultValue !== text && area !== document.activeElement && !typing) area.value = area.defaultValue; // as showRendered, for a textarea's text
    if (select) showChosen(select, chosen);
  } else if (old.textContent !== next.textContent) {
    old.textContent = next.textContent;
  }
}

export function removeNode(node: ChildNode, hooks: MorphHooks): void {
  if (node instanceof Element && isApplet(node)) hooks.onAppletRemoved?.(node);
  for (const applet of node instanceof Element ? node.querySelectorAll("[data-applet]") : []) {
    hooks.onAppletRemoved?.(applet);
  }
  node.remove();
}

/**
 * Which of `olds` each of `nexts` reuses, in order, noted in `matched`: the longest run of the same
 * types the two have in common. So a child put in or taken out ahead of its siblings leaves them be,
 * where matching by place alone rebuilt every one after it (and took the caret from a button among
 * them). The same head and tail are matched by place first, so a long list changed in the middle
 * costs little; a middle too big to compare is matched by place, as before.
 */
function matchInOrder(olds: ChildNode[], nexts: ChildNode[], matched: Map<ChildNode, ChildNode>): void {
  let head = 0;
  while (head < olds.length && head < nexts.length && sameType(olds[head]!, nexts[head]!)) matched.set(nexts[head]!, olds[head++]!);
  let tail = 0;
  while (tail < olds.length - head && tail < nexts.length - head && sameType(olds.at(-1 - tail)!, nexts.at(-1 - tail)!)) {
    matched.set(nexts.at(-1 - tail)!, olds.at(-1 - tail)!);
    tail++;
  }
  const o = olds.slice(head, olds.length - tail);
  const n = nexts.slice(head, nexts.length - tail);
  if (o.length * n.length > 250_000) {
    n.forEach((node, i) => o[i] && sameType(o[i]!, node) && matched.set(node, o[i]!));
    return;
  }
  // longest common subsequence, by type: runs[i][j] is its length over n from i and o from j
  const width = o.length + 1;
  const runs = new Uint32Array((n.length + 1) * width);
  for (let i = n.length - 1; i >= 0; i--) {
    for (let j = o.length - 1; j >= 0; j--) {
      runs[i * width + j] = sameType(n[i]!, o[j]!) ? runs[(i + 1) * width + j + 1]! + 1 : Math.max(runs[(i + 1) * width + j]!, runs[i * width + j + 1]!);
    }
  }
  for (let i = 0, j = 0; i < n.length && j < o.length; ) {
    if (sameType(n[i]!, o[j]!) && runs[i * width + j] === runs[(i + 1) * width + j + 1]! + 1) matched.set(n[i++]!, o[j++]!);
    else if (runs[(i + 1) * width + j]! >= runs[i * width + j + 1]!) i++;
    else j++;
  }
}

/** The ids inside a node, its own not counted. */
const idsWithin = (node: ChildNode): string[] => (node instanceof Element ? [...node.querySelectorAll("[id]")].map((el) => el.id) : []);

function morphChildren(old: Element, next: Element, hooks: MorphHooks): void {
  const oldNodes = [...old.childNodes];
  const newNodes = [...next.childNodes];
  /** Each new child, and the old one it reuses. */
  const matched = new Map<ChildNode, ChildNode>();

  // a child with an id is its own by the id; the rest by type, in order
  const oldByKey = new Map<string, ChildNode>();
  for (const node of oldNodes) {
    const id = key(node);
    if (id) oldByKey.set(id, node);
  }
  for (const node of newNodes) {
    const id = key(node);
    const match = id && oldByKey.get(id);
    if (match) matched.set(node, match);
  }
  // one without is known by the ids inside it: the child holding a row or an applet goes on holding it,
  // whatever stands around it (a window closing drops its rail and tools, and draws a summary)
  const unkeyedOld = oldNodes.filter((node) => !key(node));
  const holding = new Map<string, ChildNode>();
  for (const node of unkeyedOld) for (const id of idsWithin(node)) if (!holding.has(id)) holding.set(id, node);
  const held = new Set<ChildNode>();
  for (const node of newNodes) {
    if (matched.has(node)) continue;
    const match = idsWithin(node).map((id) => holding.get(id)).find((old) => old && !held.has(old) && sameType(old, node));
    if (match) {
      matched.set(node, match);
      held.add(match);
    }
  }
  matchInOrder(
    unkeyedOld.filter((node) => !held.has(node)),
    newNodes.filter((node) => !matched.has(node)),
    matched,
  );
  const used = new Set(matched.values());

  // what is not reused goes first, so what stays need not move past it (a node moved loses the caret)
  for (const node of oldNodes) {
    if (!used.has(node) && node.parentNode === old) removeNode(node, hooks);
  }

  newNodes.forEach((newNode, i) => {
    const match = matched.get(newNode);
    if (match) {
      const atPosition = old.childNodes[i];
      if (match !== atPosition) old.insertBefore(match, atPosition ?? null);
      morphNode(match, newNode, hooks);
    } else {
      old.insertBefore(newNode.cloneNode(true), old.childNodes[i] ?? null);
    }
  });
}

export function morph(target: Element, html: string, hooks: MorphHooks = {}): void {
  const next = document.createElement(target.tagName);
  next.innerHTML = html;
  keepingChoices(() => morphChildren(target, next, hooks));
}

const SVG = "http://www.w3.org/2000/svg";

/**
 * The first element of `html`, parsed as it would be where `old` stands. A <template> parses as
 * HTML, so an element in an <svg> is parsed in an <svg> instead: it comes back SVG, and so does
 * what is in it, its attributes in their own case (`gradientUnits`, not `gradientunits`).
 */
function parsedFor(old: Element, html: string): Element | null {
  if (old.namespaceURI === SVG) {
    const holder = document.createElementNS(SVG, "svg");
    holder.innerHTML = html;
    return holder.firstElementChild;
  }
  const holder = document.createElement("template");
  holder.innerHTML = html;
  return holder.content.firstElementChild;
}

/**
 * Gives an existing element the attributes of `tag`, an opening tag, and leaves what is inside it
 * alone -- a render in parts' `tag`, for a part whose own attributes changed and nothing else. An
 * applet's element is told when its props change, as in a morph.
 */
export function morphTag(old: Element, tag: string, hooks: MorphHooks = {}): void {
  const next = parsedFor(old, tag);
  if (!next) return;
  if (isApplet(old)) morphApplet(old, next, hooks);
  else morphAttributes(old, next, hooks);
}

/**
 * Reconciles one existing element against the HTML of one element -- a fragment render's
 * `replace`. Same tag (and same applet, if any) is morphed in place; anything else is swapped
 * for the new element, and the old one removed as a morph removes a child, its applets told.
 */
export function morphElement(old: Element, html: string, hooks: MorphHooks = {}): void {
  const next = parsedFor(old, html);
  if (next && sameType(old, next)) return morphNode(old, next, hooks);
  if (next) old.after(next.cloneNode(true));
  removeNode(old, hooks);
}

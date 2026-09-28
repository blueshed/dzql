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
export type MorphHooks = {
  /** Called when a mounted applet's element is about to be removed. */
  onAppletRemoved?(el: Element): void;
  /** Called when a mounted applet's element survives but its data-props changed. */
  onAppletPropsChanged?(el: Element, props: unknown): void;
  /** Whether someone is pressing this box: its tick is theirs until the click lands. */
  pressed?(el: Element): boolean;
};

function isElement(node: ChildNode | Element): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isApplet(node: ChildNode): node is Element {
  return isElement(node) && node.hasAttribute("data-applet");
}

function sameType(a: ChildNode, b: ChildNode): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (!isElement(a) || !isElement(b)) return true;
  if (a.tagName !== b.tagName) return false;
  // An applet's element is only ever reused for the same applet. Matched positionally with a
  // plain element (or another applet), its hand-managed children -- which the morph never
  // descends into -- would survive under the new element's attributes.
  return a.getAttribute("data-applet") === b.getAttribute("data-applet");
}

function key(node: ChildNode): string | undefined {
  return isElement(node) && node.id ? node.id : undefined;
}

function morphAttributes(old: Element, next: Element, hooks: MorphHooks): void {
  // a tick not yet drawn, or a box being pressed, is the person's; its tick is set now, so no
  // attribute below moves it (a box nobody has touched follows its `checked` attribute)
  const unsent = old instanceof HTMLInputElement && (old.checked !== old.defaultChecked || hooks.pressed?.(old) === true);
  if (unsent) old.checked = old.checked;
  for (const { name } of [...old.attributes]) {
    if (!next.hasAttribute(name)) {
      old.removeAttribute(name);
      showRendered(old, name, unsent);
    }
  }
  for (const { name, value } of [...next.attributes]) {
    if (old.getAttribute(name) !== value) {
      old.setAttribute(name, value);
      showRendered(old, name, unsent);
    }
  }
}

/**
 * A field nobody is in shows what was just rendered into it. Once typed in, a field's value no
 * longer follows its `value` attribute (nor a textarea's its text), so after an undo it would go
 * on showing the value undone -- and an editing form, comparing it with what was rendered, would
 * send it again. Only when the render changed it, so an unrelated render keeps what is typed.
 * A box or a radio is a select's kind of field (showChosen): it keeps a tick not yet drawn, and
 * otherwise shows what is drawn, whether or not someone is in it.
 */
function showRendered(el: Element, name: string, unsent: boolean): void {
  if (!(el instanceof HTMLInputElement)) return;
  if (name === "checked") {
    if (!unsent) el.checked = el.defaultChecked;
  } else if (name === "value" && el !== document.activeElement) el.value = el.defaultValue;
}

/** The radios of one group: those of one name, in one form (or in none). */
export const radiosOf = (form: HTMLFormElement | null, name: string): HTMLInputElement[] =>
  [...document.querySelectorAll<HTMLInputElement>("input[type=radio]")].filter((r) => r.name === name && r.form === form);

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

/** The option a select was drawn showing, by the browser's own rule: the last rendered `selected`, else its first not disabled -- or, in a list (`size` over 1), none. */
export function drawnOption(select: HTMLSelectElement): HTMLOptionElement | undefined {
  const options = [...select.options];
  return options.findLast((o) => o.defaultSelected) ?? (select.size > 1 ? undefined : options.find((o) => !o.matches(":disabled")));
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
  const before = old.getAttribute("data-props");
  morphAttributes(old, next, hooks);
  const after = old.getAttribute("data-props");
  if (hooks.onAppletPropsChanged && after !== before) {
    hooks.onAppletPropsChanged(old, after ? JSON.parse(after) : undefined);
  }
}

function morphNode(old: ChildNode, next: ChildNode, hooks: MorphHooks): void {
  if (isElement(old) && isElement(next)) {
    if (old.hasAttribute("data-applet")) {
      morphApplet(old, next, hooks);
      return;
    }
    morphAttributes(old, next, hooks);
    const area = old instanceof HTMLTextAreaElement ? old : undefined;
    const text = area?.defaultValue;
    const select = old instanceof HTMLSelectElement && !old.multiple ? old : undefined; // a multiple select is not a field (app.ts): the browser's alone
    const chosen = select && select.value !== (drawnOption(select)?.value ?? "") ? select.value : undefined; // not yet drawn
    morphChildren(old, next, hooks);
    if (area && area.defaultValue !== text && area !== document.activeElement) area.value = area.defaultValue; // as showRendered, for a textarea's text
    if (select) showChosen(select, chosen);
  } else if (old.textContent !== next.textContent) {
    old.textContent = next.textContent;
  }
}

export function removeNode(node: ChildNode, hooks: MorphHooks): void {
  if (isApplet(node)) hooks.onAppletRemoved?.(node);
  for (const applet of isElement(node) ? node.querySelectorAll("[data-applet]") : []) {
    hooks.onAppletRemoved?.(applet);
  }
  node.remove();
}

/**
 * Which of `olds` each of `nexts` reuses, in order: the longest run of the same types the two have in
 * common. So a child put in or taken out ahead of its siblings leaves them be, where matching by place
 * alone rebuilt every one after it (and took the caret from a button among them). The same head and
 * tail are matched by place first, so a long list changed in the middle costs little; a middle too
 * big to compare is matched by place, as before.
 */
function matchInOrder(olds: ChildNode[], nexts: ChildNode[]): Map<ChildNode, ChildNode> {
  const matched = new Map<ChildNode, ChildNode>();
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
    return matched;
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
  return matched;
}

/** The ids inside a node, its own not counted. */
const idsWithin = (node: ChildNode): string[] => (isElement(node) ? [...node.querySelectorAll("[id]")].map((el) => el.id) : []);

function morphChildren(old: Element, next: Element, hooks: MorphHooks): void {
  const oldNodes = [...old.childNodes];
  const newNodes = [...next.childNodes];

  const oldByKey = new Map<string, ChildNode>();
  for (const node of oldNodes) {
    const k = key(node);
    if (k) oldByKey.set(k, node);
  }

  // a child with an id is its own by the id; the rest by type, in order
  const byKey = new Map<ChildNode, ChildNode>();
  for (const node of newNodes) {
    const k = key(node);
    const match = k ? oldByKey.get(k) : undefined;
    if (match) byKey.set(node, match);
  }
  // one without is known by the ids inside it: the child holding a row or an applet goes on holding it,
  // whatever stands around it (a window closing drops its rail and tools, and draws a summary)
  const unkeyedOld = oldNodes.filter((node) => !key(node));
  const holding = new Map<string, ChildNode>();
  for (const node of unkeyedOld) for (const id of idsWithin(node)) if (!holding.has(id)) holding.set(id, node);
  const byIds = new Map<ChildNode, ChildNode>();
  const held = new Set<ChildNode>();
  for (const node of newNodes) {
    if (byKey.has(node)) continue;
    const match = idsWithin(node).map((id) => holding.get(id)).find((old) => old && !held.has(old) && sameType(old, node));
    if (match) {
      byIds.set(node, match);
      held.add(match);
    }
  }
  const inOrder = matchInOrder(
    unkeyedOld.filter((node) => !held.has(node)),
    newNodes.filter((node) => !byKey.has(node) && !byIds.has(node)),
  );
  const matchOf = (node: ChildNode): ChildNode | undefined => byKey.get(node) ?? byIds.get(node) ?? inOrder.get(node);
  const used = new Set(newNodes.map(matchOf));

  // what is not reused goes first, so what stays need not move past it (a node moved loses the caret)
  for (const node of oldNodes) {
    if (!used.has(node) && node.parentNode === old) removeNode(node, hooks);
  }

  newNodes.forEach((newNode, i) => {
    const match = matchOf(newNode);
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
 * for the new element, applets inside the old one cleaned up first.
 */
export function morphElement(old: Element, html: string, hooks: MorphHooks = {}): void {
  const next = parsedFor(old, html);
  if (!next) {
    removeNode(old, hooks);
    return;
  }
  if (sameType(old, next)) {
    morphNode(old, next, hooks);
  } else {
    old.replaceWith(next.cloneNode(true));
    if (isApplet(old)) hooks.onAppletRemoved?.(old);
    for (const applet of old.querySelectorAll("[data-applet]")) hooks.onAppletRemoved?.(applet);
  }
}

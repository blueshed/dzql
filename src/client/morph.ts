// Reconciles `target`'s children against `html` in place, instead of
// replacing them outright. The DOM nodes a person is focused on, has typed
// into, or has scrolled -- survive a render because their elements do,
// as long as this can find them again in the new tree.
//
// The HTML here is always server-authored (nothing on the client mutates
// the DOM except applets, fenced off below), so the long tail of general
// keyed-list reconciliation doesn't apply: same tag in the same place is
// reused, a different tag is replaced, and children are matched by `id`
// first, then by position. That's enough for lists that only grow, shrink,
// or update in place, which is all this app ever renders.
export type MorphHooks = {
  /** Called when a mounted applet's element is about to be removed. */
  onAppletRemoved?(el: Element): void;
  /** Called when a mounted applet's element survives but its data-props changed. */
  onAppletPropsChanged?(el: Element, props: unknown): void;
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

function morphAttributes(old: Element, next: Element): void {
  for (const { name } of [...old.attributes]) {
    if (!next.hasAttribute(name)) old.removeAttribute(name);
  }
  for (const { name, value } of [...next.attributes]) {
    if (old.getAttribute(name) !== value) old.setAttribute(name, value);
  }
}

// An applet's subtree is the applet's: reconcile the element itself, but
// never descend into its children -- a morph diffing "the new HTML" against
// DOM the applet manages by hand would fight it for its own children.
function morphApplet(old: Element, next: Element, hooks: MorphHooks): void {
  const before = old.getAttribute("data-props");
  morphAttributes(old, next);
  const after = old.getAttribute("data-props");
  if (hooks.onAppletPropsChanged && after !== before) {
    hooks.onAppletPropsChanged(old, after ? JSON.parse(after) : undefined);
  }
}

function morphNode(old: ChildNode, next: ChildNode, hooks: MorphHooks): void {
  if (isElement(old) && isElement(next)) {
    if (isApplet(old)) {
      morphApplet(old, next, hooks);
      return;
    }
    morphAttributes(old, next);
    morphChildren(old, next, hooks);
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

function morphChildren(old: Element, next: Element, hooks: MorphHooks): void {
  const oldNodes = [...old.childNodes];
  const newNodes = [...next.childNodes];

  const oldByKey = new Map<string, ChildNode>();
  for (const node of oldNodes) {
    const k = key(node);
    if (k) oldByKey.set(k, node);
  }

  const used = new Set<ChildNode>();

  newNodes.forEach((newNode, i) => {
    const k = key(newNode);
    let match = k ? oldByKey.get(k) : undefined;
    if (!match) {
      const positional = oldNodes[i];
      if (positional && !used.has(positional) && !key(positional) && sameType(positional, newNode)) {
        match = positional;
      }
    }

    if (match) {
      used.add(match);
      const atPosition = old.childNodes[i];
      if (match !== atPosition) old.insertBefore(match, atPosition ?? null);
      morphNode(match, newNode, hooks);
    } else {
      old.insertBefore(newNode.cloneNode(true), old.childNodes[i] ?? null);
    }
  });

  for (const node of oldNodes) {
    if (!used.has(node) && node.parentNode === old) removeNode(node, hooks);
  }
}

export function morph(target: Element, html: string, hooks: MorphHooks = {}): void {
  const next = document.createElement(target.tagName);
  next.innerHTML = html;
  morphChildren(target, next, hooks);
}

/**
 * Reconciles one existing element against the HTML of one element -- a fragment render's
 * `replace`. Same tag (and same applet, if any) is morphed in place; anything else is swapped
 * for the new element, applets inside the old one cleaned up first.
 */
export function morphElement(old: Element, html: string, hooks: MorphHooks = {}): void {
  const holder = document.createElement("template");
  holder.innerHTML = html;
  const next = holder.content.firstElementChild;
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

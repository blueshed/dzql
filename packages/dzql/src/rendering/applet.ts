import { mount } from "@blueshed/railroad/jsx";
import { signal, type ReadonlySignal, type Signal } from "@blueshed/railroad/signals";
import type { Applet, AppletContext } from "./applets";
import type { PatchOp } from "./json-patch";

// An applet drawn by railroad (`@blueshed/railroad`) instead of by hand. The page is the
// server's; an applet is the one piece whose client-side state a render would destroy, and this
// is that piece written as a railroad component. Its props are a signal: a render that gives
// the element new `data-props` sets it (`update`), and so do its document's ops as they are echoed,
// through `reduce` (`patch`). Built on railroad's `signal` and `mount` and nothing else.
//
// It draws only inside its element, and never binds the element's own attributes: those are
// the page's, which the morph keeps (src/rendering/client/morph.ts), as it never descends into the element.
// What the server rendered inside it -- the zones as `<option>`s -- is `render`'s to read, and is
// then replaced by what `render` draws, so HTML stays the vocabulary.

export function applet<P>(
  render: (props: ReadonlySignal<P>, ctx: AppletContext, el: HTMLElement) => Node,
  reduce?: (props: P, ops: PatchOp[]) => P,
): Applet {
  const held = new WeakMap<HTMLElement, Signal<P>>();
  return {
    mount(el, ctx) {
      const props = signal(ctx.props as P);
      held.set(el, props);
      const dispose = mount(el, () => {
        const drawn = render(props, ctx, el);
        el.replaceChildren(); // the server's, read; now the applet's
        return drawn;
      });
      return () => {
        dispose();
        held.delete(el);
      };
    },
    update(el, props) {
      held.get(el)?.set(props as P);
    },
    ...(reduce && {
      patch(el: HTMLElement, ops: PatchOp[]) {
        const props = held.get(el);
        if (props) props.set(reduce(props.peek(), ops));
      },
    }),
  };
}

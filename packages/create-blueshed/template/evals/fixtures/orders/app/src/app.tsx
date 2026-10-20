/**
 * App — client entry point: the socket the documents ride, and the page, a bento box drawn from
 * resources (src/resources/bento.tsx). Where you are is the URL: `#/` is the box, `#/?message` the
 * message's drawer open over it.
 *
 * To add a resource to the page: its cell in `cells`, a deed of the page's beside its name in
 * `actions`, its drawer in `drawerOf`, its new-or-delete in `modalOf`, each by its `what`.
 */
import { connectWs, redo, undo, WS } from "@blueshed/delta/client";
import { mount, provide } from "@blueshed/railroad";
import { bento, layers, paged, type Address } from "./resources/bento";
import { MessageCell, MessageDrawer } from "./resources/message/message-view";
import { StatusCell } from "./resources/status/status-view";
import { CatalogueCell, KitchenCell, OrderCell } from "./resources/order/order-view";

// One socket for every document the page opens; it reconnects, and reopens them, by itself
provide(WS, connectWs("/ws"));

const { boxPage } = bento({ undo: () => void undo(), redo: () => void redo() }); // this page's last change, taken back and put back
const name = document.title; // the app's name, said once, in index.html

/** The box's cells, in its order: bigger for what matters more. */
const cells = () => [
  MessageCell(),
  StatusCell(),
  CatalogueCell(),
  OrderCell(),
  KitchenCell(),
];

/** The page's own deeds, beside its name. */
const actions = (): Node[] => [
];

/** A thing's drawer over the box, by its `what`: where it is changed. */
function drawerOf(at: Address): Node | null {
  if (at.what === "message") return MessageDrawer();
  return null; // nothing open
}

/** What asks over the box, by its `what`: something new, or whether to remove it. */
function modalOf(at: Address): Node | null {
  return null; // nothing asks
}

mount(document.getElementById("app")!, () =>
  layers(
    paged((path) =>
      path === "" ? (
        boxPage([{ label: name }], [], cells(), undefined, { actions: actions() })
      ) : (
        <p>
          Page not found!
          <br />
          <a href="#">&larr; home</a>
        </p>
      ),
    ),
    drawerOf,
    modalOf,
  ),
);

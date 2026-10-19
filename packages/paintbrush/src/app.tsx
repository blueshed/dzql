/**
 * App — client entry point: the socket the documents ride, and the page, a bento box drawn from
 * resources (src/resources/bento.tsx). Where you are is the URL: `#/` is the box, `#/?message` the
 * message's drawer open over it.
 *
 * To add a page: a path in `paged` below, drawn from its resources' cells; to add a drawer or a
 * modal, a `what` in `layers`.
 */
import { connectWs, WS } from "@blueshed/delta/client";
import { mount, provide } from "@blueshed/railroad";
import { bento, layers, paged } from "./resources/bento";
import { MessageCell, MessageDrawer } from "./resources/message/message-view";
import { StatusCell } from "./resources/status/status-view";

// One socket for every document the page opens; it reconnects, and reopens them, by itself
provide(WS, connectWs("/ws"));

const { boxPage } = bento();
const name = document.title; // the app's name, said once, in index.html

mount(document.getElementById("app")!, () =>
  layers(
    paged((path) =>
      path === "" ? (
        boxPage([{ label: name }], [], [MessageCell(), StatusCell()], undefined, {})
      ) : (
        <p>
          Page not found!
          <br />
          <a href="#">&larr; home</a>
        </p>
      ),
    ),
    (at) => (at.what === "message" ? MessageDrawer() : null),
    null,
  ),
);

/**
 * App — client entry point: the socket the documents ride, and the routes, each drawn from resources.
 *
 * To add a page: import its view and add a route entry below.
 */
import { connectWs, WS } from "@blueshed/delta/client";
import { provide, routes } from "@blueshed/railroad";
import { MessageView } from "./resources/message/message-view";
import { StatusView } from "./resources/status/status-view";

// One socket for every document the page opens; it reconnects, and reopens them, by itself
provide(WS, connectWs("/ws"));

routes(document.getElementById("app")!, {
  "/": () => (
    <>
      <MessageView />
      <StatusView />
    </>
  ),
  "*": () => (
    <p>
      Page not found!
      <br />
      <a href="#">&larr; home</a>
    </p>
  ),
});

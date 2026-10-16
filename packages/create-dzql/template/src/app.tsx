/**
 * App — client entry point: the socket the documents ride, and the routes, each drawn from resources.
 *
 * To add a page: import its view and add a route entry below.
 */
import { connectWs, WS } from "@blueshed/delta/client";
import { provide, routes } from "@blueshed/railroad";
import { signInAgain } from "./resources/auth/auth";
import { AuthView } from "./resources/auth/auth-view";
import { PostsView } from "./resources/posts/posts-view";

// One socket for every document the page opens; it reconnects, and reopens them, by itself,
// signed in again first as whoever this browser signed in as
provide(WS, connectWs("/ws", { onConnect: signInAgain }));

routes(document.getElementById("app")!, {
  "/": () => (
    <>
      <AuthView />
      <PostsView />
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

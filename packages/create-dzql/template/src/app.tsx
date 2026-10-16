/**
 * App — client entry point: the socket the documents ride, and the routes, each drawn from resources.
 *
 * To add a page: import its view and add a route entry below.
 */
import { connectWs, WS } from "@blueshed/delta/client";
import { provide, routes } from "@blueshed/railroad";
import { takeLink, whoAmI } from "./resources/auth/auth";
import { AuthView } from "./resources/auth/auth-view";
import { PeopleView } from "./resources/people/people-view";
import { PostsView } from "./resources/posts/posts-view";
import { toast } from "./resources/toast";

// Opened by a link (#/in/<token>)? Its tap signs in, before the socket connects with the cookie it set
const taken = await takeLink();
if (taken && "error" in taken) toast(taken.error, "alert");

// One socket for every document the page opens; it reconnects, and reopens them, by itself
provide(WS, connectWs("/ws", { onConnect: whoAmI }));

routes(document.getElementById("app")!, {
  "/": () => (
    <>
      <AuthView />
      <PostsView />
      <PeopleView />
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

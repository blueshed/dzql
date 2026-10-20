/**
 * The page: a link taken, if it was opened by one; the socket every document rides, signed in by
 * the session cookie; and each resource's view. Signed in, your lists and everyone here; nobody,
 * "Who are you?".
 */
import { connectWs, WS } from "@blueshed/delta/client";
import { mount, provide, signal, when } from "@blueshed/railroad";
import { me, takeLink, whoAmI } from "./resources/people/people";
import { Me, PeopleView, WhoAreYou } from "./resources/people/people-view";
import { ListsView } from "./resources/lists/lists-view";

const said = signal("");

// Opened by a link (#/in/<token>)? Its tap signs in, and the page starts again as them
void takeLink().then((taken) => taken && ("error" in taken ? said.set(taken.error) : location.reload()));

// One socket for every document; on every connect, before any document opens, who it is. Its
// clientId (with the person) is the cursor undo walks: chosen here, it lasts across reconnects
provide(WS, connectWs("/ws", { clientId: crypto.randomUUID(), onConnect: whoAmI }));

mount(document.getElementById("root")!, () => (
  <>
    <h1>Lists</h1>
    <p class="note">{said}</p>
    {when(me,
      (me$) => <><Me /><ListsView me={me$.peek()} /><PeopleView /></>,
      () => when(me.map((m) => m === null), () => <WhoAreYou />, () => <div class="pending">connecting…</div>))}
  </>
));

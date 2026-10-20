/**
 * The page: the socket every document rides, and each resource's view. A socket that drops has
 * left the lobby, so on every connect the page joins again as whoever it was.
 */
import { connectWs, WS } from "@blueshed/delta/client";
import { mount, provide, when } from "@blueshed/railroad";
import { here, rejoin } from "./resources/here/here";
import { HereView } from "./resources/here/here-view";
import { LoadView } from "./resources/load/load-view";

// One socket for every document the page opens: openDoc finds it
provide(WS, connectWs("/ws", { onConnect: rejoin }));

mount(document.getElementById("root")!, () => (
  <>
    <h1>Lobby</h1>
    {when(here.data, () => <HereView />, () => <div class="pending">connecting…</div>)}
    <LoadView />
  </>
));

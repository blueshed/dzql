/**
 * The page: the socket every document rides, and each resource's view. One
 * resource here, the board (resources/board/).
 */
import { connectWs, WS } from "@blueshed/delta/client";
import { mount, provide, when } from "@blueshed/railroad";
import { board } from "./resources/board/board";
import { BoardView } from "./resources/board/board-view";

// One socket for every document the page opens: openDoc finds it
provide(WS, connectWs("/ws"));

mount(document.getElementById("root")!, () =>
  when(board.data,
    () => <BoardView />,
    () => <div class="pending">connecting…</div>,
  ),
);

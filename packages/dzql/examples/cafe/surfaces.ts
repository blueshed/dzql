import { bento } from "dzql/rendering/bento";
import { icon } from "./icons";

/** The bento's surfaces, drawn with the cafe's marks, the visit the session, Undo and Redo (its documents are on the ledger), and signing out its leave. */
export const surfaces = bento({ icon, session: "visit", undo: true, leave: { text: "Sign out", icon: "log-out", path: "/role" } });

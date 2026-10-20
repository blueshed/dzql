import { bento } from "dzql/rendering/bento";
import { icon } from "./icons";

/** The bento's surfaces, drawn with chat's marks, the session the session, Undo and Redo, and logging out its leave. */
export const surfaces = bento({ icon, session: "session", undo: true, leave: { text: "Log out", icon: "log-out", path: "/name" } });

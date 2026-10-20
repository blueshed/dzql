import { bento } from "dzql/rendering/bento";
import { icon } from "./icons";

/** The bento's surfaces, drawn with leave's marks, the session the session, Undo and Redo, and signing out its leave. */
export const surfaces = bento({ icon, session: "session", undo: true, leave: { text: "Sign out", icon: "log-out", path: "/person_id" } });

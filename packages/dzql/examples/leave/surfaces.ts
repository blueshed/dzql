import { bento } from "dzql/rendering/bento";
import { icon } from "./icons";

/** The bento's surfaces, drawn with leave's marks, the session the session, and signing out its leave. */
export const surfaces = bento({ icon, session: "session", leave: { text: "Sign out", icon: "log-out", path: "/person_id" } });

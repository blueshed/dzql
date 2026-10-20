import { bento } from "dzql/rendering/bento";
import { icon } from "./icons";

/** The bento's surfaces, drawn with chat's marks, the session the session, and logging out its leave. */
export const surfaces = bento({ icon, session: "session", leave: { text: "Log out", icon: "log-out", path: "/name" } });

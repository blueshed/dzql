import { bento } from "dzql/rendering/bento";
import { icon } from "./icons";

/** The bento's surfaces, drawn with the cafe's marks, the visit the session, and signing out its leave. */
export const surfaces = bento({ icon, session: "visit", leave: { text: "Sign out", icon: "log-out", path: "/role" } });

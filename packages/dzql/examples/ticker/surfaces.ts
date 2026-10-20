import { bento } from "dzql/rendering/bento";
import { icon } from "./icons";

/** The bento's surfaces, drawn with the ticker's marks, the desk the session; nobody signs in, so there is no leaving. */
export const surfaces = bento({ icon, session: "desk" });

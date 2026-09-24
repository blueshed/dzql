import { migrate } from "../../src/migrate";
import { db } from "../../src/db";

// chat on delta: the session (eta's tray) keeps its own table under this example's namespace; the
// rooms and their messages are delta's, created by delta.ts. Every table here is prefixed `cd_`,
// since a dev database can hold chat's `sessions` and `messages` already.
migrate(db, `${import.meta.dir}/migrations`, "chat-delta");

export { db };

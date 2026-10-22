import type { Local } from "@blueshed/delta/local";
import { failed } from "./failed";

// A session is a row, numbered as every row is: its table's serial names it, as a Postgres BIGINT's
// sequence would. The cookie is not its number -- a number could be guessed -- but a random token,
// a person's only credential, and the row keeps the token's SHA-256 (`cookie`), never the token. A
// visit's first socket makes its row; every socket after finds it by the cookie's hash.
//
// The row is found and made through a list document scoped by that column, which holds the one
// session a cookie names (`add /<sessions>/-` through it is given the hash, and the serial names
// the row): `defineDoc("visit:", { root: "sessions", scope: { cookie: ":cookie" }, include: [] })`,
// registered off the ledger. The session's own document (`session:<n>`) holds every column but
// `cookie` (`columns`), so the hash is never drawn, told or written.
//
// A session lasts while it is used, where its row keeps when it last was (`Kept.seen`, a
// `timestamptz?` column the session's own document leaves out): past `days` unused (30), its
// cookie names a fresh session, nobody's -- a cookie stolen and kept is worth nothing -- and the
// rows past them are let go, at most once an hour, through a list document scoped by that column
// (`Kept.expired`): `defineDoc("expired:", { root: "sessions", scope: { seen: "<:before" }, include: [] })`.

/** A cookie's hash, as its session's row keeps it. */
const hashOf = (cookie: string): string => new Bun.CryptoHasher("sha256").update(cookie).digest("hex");

export type Sessions = {
  /** The session `cookie` names: its row's number, the row made the first time the cookie is seen. */
  of(cookie: string): Promise<string>;
  /** A fresh cookie, and its session made holding `value` (who signed in): a sign-in's, never the visit's own. */
  start(value?: Record<string, unknown>): Promise<{ cookie: string; sessionId: string }>;
};

/** How a session lasts: the column its row keeps its last use in, how many days unused it lasts, and the document the rows past them are let go through. */
export type Kept = { seen: string; days?: number; expired?: string };

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * The sessions kept as rows of `collection`, found and made through the list document `visit`
 * (`<visit><hash>`), opened by a caller of its own and closed again: the kernel's copies are
 * never touched. One at a time, so two tabs opening at once on a new cookie make one row. With
 * `kept`, each lasts `days` unused, renewed as it is used (written at most once a day).
 */
export function sessionRows(delta: Local, collection: string, visit = "visit:", kept?: Kept): Sessions {
  const caller = delta.as({ sessions: collection });
  const days = kept?.days ?? 30;
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  const call = async (action: string, msg: Record<string, unknown>): Promise<any> => {
    const answer = await caller.call(action, msg);
    if (answer.error) throw new Error(`${action} ${String(msg.doc)}: ${answer.error.message}`);
    return answer.result;
  };
  /** A document's rows, opened and closed again. */
  const rowsOf = async (doc: string): Promise<[string, Record<string, unknown>][]> => {
    try {
      return Object.entries((await call("open", { doc }))[collection] ?? {});
    } finally {
      await caller.call("close", { doc });
    }
  };
  /** When a row was last used; a row from before it was kept, now. */
  const lastUsed = (row: Record<string, unknown>): number => (row[kept!.seen] == null ? Date.now() : Date.parse(String(row[kept!.seen])));
  const live = (row: Record<string, unknown>): boolean => !kept || Date.now() - lastUsed(row) < days * DAY;

  // the rows unused past their days, let go: at most once an hour, the first visit after
  let swept = 0;
  async function sweep(): Promise<void> {
    if (!kept?.expired || Date.now() - swept < HOUR) return;
    swept = Date.now();
    const doc = `${kept.expired}${new Date(Date.now() - days * DAY).toISOString().slice(0, 10)}`; // by the day, as a name holds it
    for (const [id, row] of await rowsOf(doc)) {
      if (live(row)) continue;
      const gone = await caller.call("delta", { doc, ops: [{ op: "remove", path: `/${collection}/${id}` }] });
      if (gone.error) failed(`letting go of an expired session (${collection} ${id})`, new Error(gone.error.message));
    }
    await caller.call("close", { doc });
  }

  const find = (cookie: string, value: Record<string, unknown>) =>
    inTurn(async () => {
      await sweep();
      const doc = `${visit}${hashOf(cookie)}`;
      const found = (await rowsOf(doc)).find(([, row]) => live(row));
      if (found) {
        const [id, row] = found;
        if (kept && (row[kept.seen] == null || Date.now() - lastUsed(row) >= DAY)) await call("delta", { doc, ops: [{ op: "replace", path: `/${collection}/${id}/${kept.seen}`, value: new Date().toISOString() }] });
        return id;
      }
      // a cookie never seen, or one whose session has run out: a fresh row
      await call("delta", { doc, ops: [{ op: "add", path: `/${collection}/-`, value: kept ? { ...value, [kept.seen]: new Date().toISOString() } : value }] });
      const made = (await rowsOf(doc)).filter(([, row]) => live(row)).at(-1)!;
      return made[0];
    });

  return {
    of: (cookie) => find(cookie, {}),
    async start(value = {}) {
      const cookie = crypto.randomUUID();
      return { cookie, sessionId: await find(cookie, value) };
    },
  };
}

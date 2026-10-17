import type { Local } from "@blueshed/delta/local";

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

/** A cookie's hash, as its session's row keeps it. */
const hashOf = (cookie: string): string => new Bun.CryptoHasher("sha256").update(cookie).digest("hex");

export type Sessions = {
  /** The session `cookie` names: its row's number, the row made the first time the cookie is seen. */
  of(cookie: string): Promise<string>;
  /** A fresh cookie, and its session made holding `value` (who signed in): a sign-in's, never the visit's own. */
  start(value?: Record<string, unknown>): Promise<{ cookie: string; sessionId: string }>;
};

/**
 * The sessions kept as rows of `collection`, found and made through the list document `visit`
 * (`<visit><hash>`), opened by a caller of its own and closed again: the kernel's copies are
 * never touched. One at a time, so two tabs opening at once on a new cookie make one row.
 */
export function sessionRows(delta: Local, collection: string, visit = "visit:"): Sessions {
  const caller = delta.as({ sessions: collection });
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
  const held = async (doc: string): Promise<string | undefined> => Object.keys((await call("open", { doc }))[collection] ?? {})[0];

  const find = (cookie: string, value: Record<string, unknown>) =>
    inTurn(async () => {
      const doc = `${visit}${hashOf(cookie)}`;
      try {
        const found = await held(doc);
        if (found !== undefined) return found;
        await call("delta", { doc, ops: [{ op: "add", path: `/${collection}/-`, value }] });
        return (await held(doc))!;
      } finally {
        await caller.call("close", { doc });
      }
    });

  return {
    of: (cookie) => find(cookie, {}),
    async start(value = {}) {
      const cookie = crypto.randomUUID();
      return { cookie, sessionId: await find(cookie, value) };
    },
  };
}

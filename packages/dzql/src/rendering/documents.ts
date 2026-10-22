import type { Local } from "@blueshed/delta/local";
import { applyOps, splitPath, type DeltaOp } from "@blueshed/delta/core";
import { failed } from "./failed";
import { reading } from "./reading";
import { scope } from "./scope";
import type { PatchOp } from "./json-patch";

// eta's documents are delta's (`@blueshed/delta`). eta keeps a copy of every document
// an open page reads, kept current from delta's one stream of changes -- this process's writes and,
// over Postgres (dzql), other processes' alike -- so a page is drawn from memory, synchronously, and never
// reads the database per viewer, per redraw. A read of a document not held yet throws `Pending`:
// `settled` loads it and runs the drawing again. A write goes to delta as the person, with the
// session as the cursor undo walks, and resolves once its change is back and held. Every change
// reaches the kernel through `onChange`: the one place eta echoes and redraws.

/** Thrown by `read` for a document not held yet; `settled` loads it and tries again. */
export class Pending extends Error {
  constructor(readonly doc: string) {
    super(`not held yet: ${doc}`);
  }
}

export type Change = { doc: string; ops: DeltaOp[]; v?: number };
export type Written = { ops: DeltaOp[]; inverse: DeltaOp[]; version?: number; entry?: number };
/** An undo or a redo: its document and entry, what it writes, and -- once walked, not on a dry walk -- what that wrote over. */
export type Walked = { doc: string; entry?: number; ops: DeltaOp[]; inverse?: DeltaOp[]; version?: number; conflict?: string[] };
export type Writer = { identity: unknown; cursor: string; undoable?: boolean };

type Held = { value: any; v?: number };

export type Documents = ReturnType<typeof createDocuments>;

export function createDocuments(local: Local) {
  const held = new Map<string, Held>();
  const loading = new Map<string, Promise<void>>();
  const listeners = new Set<(change: Change) => void | Promise<void>>();
  const inflight = new Set<Promise<unknown>>();
  const waiting = new Map<string, { v: number; resolve: () => void }[]>();
  // Changes are told one at a time, in the order they came: what one change sets going (a
  // resource keeping who is here) is done before the next is told, so it is never done twice.
  let telling: Promise<void> = Promise.resolve();

  // the one stream of changes: every publish on a document's channel
  const unheard = local.onPublish((doc, data) => {
    if (!data || data.doc !== doc || !Array.isArray(data.ops)) return;
    const h = held.get(doc);
    if (h) {
      if (data.v !== undefined && h.v !== undefined && data.v <= h.v) return; // held already
      const missed = data.v !== undefined && h.v !== undefined && data.v > h.v + 1;
      if (missed || !lands(h, data.ops)) {
        // a change missed, or one that does not land on the copy (a remove of what it does not
        // hold): the copy is not to be trusted -- load it again, tell it as a whole-document
        // change, and let go of whatever waits for a version it has reached
        held.delete(doc);
        track(load(doc).then(() => {
          const again = held.get(doc)!;
          reached(doc, again.v ?? Infinity);
          return told({ doc, ops: [{ op: "replace", path: "", value: again.value }], v: again.v });
        }));
        return;
      }
      if (data.v !== undefined) h.v = data.v;
    }
    track(told({ doc, ops: data.ops, v: data.v }));
    if (data.v !== undefined) reached(doc, data.v);
  });

  /**
   * Lays `ops` on what `h` holds, and holds that; false, holding what it did, when they do not land
   * on it (RFC 6902: a remove of what is not there). What is held is never changed in place: a
   * drawing, or a change still to be told, may hold any of it. So each op is laid on a copy of what
   * it touches alone -- the containers on its path, each copied once a change -- and the rest is
   * shared with what was held before (`touched`).
   */
  const lands = (h: Held, ops: DeltaOp[]): boolean => {
    if (h.value === undefined) return true;
    const next = touched(h.value, ops);
    if (next === undefined) return false;
    h.value = next;
    return true;
  };

  /** Lets go of whatever waits for `doc` to reach `v` or before. */
  const reached = (doc: string, v: number): void => {
    const all = waiting.get(doc);
    if (!all) return;
    waiting.set(doc, all.filter((w) => w.v > v));
    for (const w of all) if (w.v <= v) w.resolve();
  };

  function track<T>(p: Promise<T>): Promise<T> {
    inflight.add(p);
    return p.finally(() => inflight.delete(p));
  }

  /** Tells every listener; one that fails is logged, and the rest are told all the same. */
  async function tell(change: Change): Promise<void> {
    for (const fn of listeners) {
      try {
        await fn(change);
      } catch (err) {
        failed(`telling a change to ${change.doc}`, err);
      }
    }
  }

  /** Tells `change` once every change before it has been told. */
  function told(change: Change): Promise<void> {
    return (telling = telling.then(() => tell(change)));
  }

  /** Opens `doc` in delta and holds it. Loading twice at once loads once. */
  function load(doc: string): Promise<void> {
    if (held.has(doc)) return Promise.resolve();
    if (!loading.has(doc)) {
      loading.set(
        doc,
        local
          .call("open", { doc })
          .then((answer) => {
            if (answer.error || !answer.result) return void held.set(doc, { value: undefined });
            const { _v, ...value } = answer.result;
            held.set(doc, { value, v: _v === undefined ? undefined : Number(_v) });
          })
          .finally(() => loading.delete(doc)),
      );
    }
    return loading.get(doc)!;
  }

  return {
    /** No longer kept current: its app is no longer served, and the next server of it holds its own. */
    forget: unheard,

    /** The document as held, noting that the page being drawn read it; throws `Pending` when not held yet. */
    read<T = any>(doc: string): T {
      return heldAs(doc).value as T;
    },

    /** The version the document is held at, as `read` reads it: what a watching applet's props hold (`watch`). */
    version(doc: string): number | undefined {
      return heldAs(doc).v;
    },
    load,

    /** Writes through delta as `by.identity`, and resolves once the change is back and held. */
    async write(doc: string, ops: DeltaOp[], by: Writer): Promise<Written | { error: { code: number; message: string } }> {
      await load(doc);
      const answer = await local.as(by.identity).call("delta", { doc, ops, cursor: by.cursor, undoable: by.undoable !== false, inverse: true });
      if (answer.error) return { error: answer.error };
      const written = answer.result as Written;
      await caughtUp(doc, written.version);
      return written;
    },

    /**
     * Undo or redo along a session's cursor: delta walks it; the change comes back like any other.
     * `dry` answers what the walk would do -- the entry, its ops, a conflict -- and walks nothing;
     * `entry` walks only if that is still the cursor's next. A walk that meets someone else's later
     * write changes nothing and says `conflict`, and the cursor moves past it all the same.
     * `change` walks one change of the cursor's, named by an entry of it, in place of its next; one
     * that is none of the cursor's is delta's error (404).
     */
    async walk(way: "undo" | "redo", by: Writer, o: { dry?: boolean; entry?: number; change?: number } = {}): Promise<Walked | null | { error: { code: number; message: string } }> {
      const answer = await local.as(by.identity).call(way, { cursor: by.cursor, ...o });
      if (answer.error) return { error: answer.error };
      const result = answer.result as Walked | null | undefined;
      if (!result) return null;
      if (!o.dry) await caughtUp(result.doc, result.version);
      return result;
    },

    /** A document's recent history, each entry saying whether this cursor wrote it. */
    async history(doc: string, cursor: string, limit?: number): Promise<{ id: number; version: number; ops: DeltaOp[]; inverse: DeltaOp[]; at: number; mine: boolean }[]> {
      const answer = await local.call("history", { doc, cursor, limit });
      return (answer.result as never) ?? [];
    },

    /** Hears every change to a document -- this process's and others' -- after it is held. */
    onChange(fn: (change: Change) => void | Promise<void>): () => void {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },

    /** Resolves when every change heard so far has been told, and every change heard meanwhile. */
    async quiet(): Promise<void> {
      while (inflight.size > 0) await Promise.all([...inflight]);
    },

    /** Resolves when every change heard so far has been told: not those heard meanwhile, which a busy app is never without. */
    async toldSoFar(): Promise<void> {
      await Promise.all([...inflight]);
    },

    /** Lets go of every held document but `keep`: closed in delta, dropped here. */
    async release(keep: Set<string>): Promise<void> {
      for (const doc of [...held.keys()]) {
        if (keep.has(doc)) continue;
        held.delete(doc);
        await local.call("close", { doc });
      }
    },
  };

  /** The document as held, noting that the page being drawn read it; throws `Pending` when not held yet. */
  function heldAs(doc: string): Held {
    reading(doc);
    const h = held.get(doc);
    if (h) return h;
    const gathered = gathering.at(-1);
    if (!gathered) throw new Pending(doc);
    gathered.set(doc, () => load(doc)); // in a run of `settled`: nothing for now, and loaded with the rest
    return { value: undefined };
  }

  /** Waits until the held copy of `doc` has reached `version` -- at once in this process, after NOTIFY over Postgres. */
  function caughtUp(doc: string, version: number | undefined): Promise<void> {
    const h = held.get(doc);
    if (version === undefined || !h || h.v === undefined || h.v >= version) return Promise.resolve();
    return new Promise((resolve) => void waiting.set(doc, [...(waiting.get(doc) ?? []), { v: version, resolve }]));
  }
}

/**
 * `value` with `ops` laid on, `value` itself left as it was: each container on an op's path copied
 * (once, however many ops pass through it), and the rest shared. Undefined when they do not land.
 */
function touched(value: unknown, ops: DeltaOp[]): unknown {
  const fresh = new Set<object>();
  const copy = (o: object): object => {
    const c = Array.isArray(o) ? [...o] : { ...o };
    fresh.add(c);
    return c;
  };
  const root = copy(value as object);
  try {
    for (const op of ops) {
      let at: any = root;
      for (const key of splitPath(op.path).slice(0, -1)) {
        const inside = Object.hasOwn(at, key) ? at[key] : undefined;
        if (inside === null || typeof inside !== "object") break; // not there: the op says so, as it fails
        if (!fresh.has(inside)) at[key] = copy(inside);
        at = at[key];
      }
      applyOps(root, [op]);
    }
  } catch {
    return undefined;
  }
  return root;
}

/**
 * The most times `settled` loads what a drawing read and runs it again, a bound against a document
 * that never stays held, far past what a page reads: each time loads every document the drawing
 * read before it first used one not held (what it made of that one stops it), so a page that reads
 * its documents and then draws them takes a round for each document named by another's contents,
 * and one that uses each as it reads it, a round for each.
 */
const MOST_ROUNDS = 1000;

/** The documents not held that the run of `settled` under way read, each with how to load it: a read gathers them rather than throwing. */
const gathering: Map<string, () => Promise<void>>[] = [];

/**
 * Runs `fn`; the documents it read and did not hold are loaded, every one together, and `fn` runs
 * again, until it reads none (at most `rounds` times). A read of one not held is nothing while it
 * runs: whatever `fn` makes of that -- an answer, or a failure -- is not its answer, which comes
 * from the run that read them all. So a page that reads its documents before it uses them waits for
 * them once, and for one named by what another holds once more.
 */
export async function settled<T>(documents: Documents | undefined, fn: () => T, rounds = MOST_ROUNDS): Promise<T> {
  if (!documents) return fn();
  for (let round = 0; ; round++) {
    const missing = new Map<string, () => Promise<void>>();
    gathering.push(missing);
    let ran: { value: T } | { error: unknown };
    try {
      ran = { value: fn() };
    } catch (error) {
      ran = { error };
    } finally {
      gathering.pop();
    }
    const error = "error" in ran ? ran.error : undefined;
    if (error instanceof Pending) missing.set(error.doc, () => documents.load(error.doc)); // thrown by a copy of its own (the stories' fresh render)
    if (missing.size === 0) {
      if ("error" in ran) throw ran.error;
      return ran.value;
    }
    if (round >= rounds) throw error instanceof Pending ? error : new Pending([...missing.keys()][0]!);
    await Promise.all([...missing.values()].map((load) => load()));
  }
}

// The app's documents, when it keeps them in delta: set as it is served, in its scope (./scope.ts),
// read by its views through `read`.
export function setActiveDocuments(documents: Documents | undefined): void {
  scope().documents = documents;
}

/** The app's documents; throws when it keeps none. */
function kept(): Documents {
  const kept = scope().documents;
  if (!kept) throw new Error("no documents: this example does not keep them in delta, or this was called outside any app's scope while several apps are served (a feed or a hook made at module load: start it from a resource's onOpen, or in the app's scope)");
  return kept;
}

/** Reads a document from the active example's copy: `room:general`, `session:<id>`. */
export function read<T = any>(doc: string): T {
  return kept().read<T>(doc);
}

/**
 * A document an applet watches, for its mount (`appletProps(props, watch("everyone:1", "/everyone"))`,
 * src/rendering/html.ts): its name, where it sits in the props, and the version it is held at as the page is
 * drawn -- the one `read` gives -- so the client passes over a patch the props already hold. Read
 * like any document, so the page is told its every change.
 */
export function watch(doc: string, under?: string): { doc: string; under?: string; v?: number } {
  return { doc, under, v: kept().version(doc) };
}

/** The active example's documents, when it keeps them in delta. */
export const activeDocuments = (): Documents | undefined => scope().documents;

/**
 * The server's own write -- to a live document it keeps true (who is here): no person, no cursor,
 * never on the ledger.
 */
export async function serverWrite(doc: string, ops: PatchOp[]): Promise<void> {
  const written = await kept().write(doc, ops as DeltaOp[], { identity: undefined, cursor: "", undoable: false });
  if ("error" in written) throw new Error(`${doc}: ${written.error.message}`);
}

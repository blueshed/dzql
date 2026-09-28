import type { Local } from "@blueshed/delta/local";
import { applyOps, type DeltaOp } from "@blueshed/delta/core";
import { failed } from "./failed";
import { reading } from "./reading";
import { splitDoc } from "./names";
import type { PatchOp } from "./json-patch";

// eta's documents are delta's (`@blueshed/delta`). eta keeps a copy of every document
// an open page reads, kept current from delta's one stream of changes -- this process's writes and,
// over Postgres, other processes' alike -- so a page is drawn from memory, synchronously, and never
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
  // compartment keeping who is here) is done before the next is told, so it is never done twice.
  let telling: Promise<void> = Promise.resolve();

  // the one stream of changes: every publish on a document's channel
  local.onPublish((doc, data) => {
    if (!data || data.doc !== doc || !Array.isArray(data.ops)) return;
    const h = held.get(doc);
    if (h) {
      if (data.v !== undefined && h.v !== undefined && data.v <= h.v) return; // held already
      const missed = data.v !== undefined && h.v !== undefined && data.v > h.v + 1;
      const next = missed ? undefined : applied(h.value, data.ops);
      if (!next) {
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
      h.value = next.value;
      if (data.v !== undefined) h.v = data.v;
    }
    track(told({ doc, ops: data.ops, v: data.v }));
    if (data.v !== undefined) reached(doc, data.v);
  });

  /** `ops` laid on a copy of `value`; nothing when they do not land on it (RFC 6902: a remove of what is not there). */
  const applied = (value: any, ops: DeltaOp[]): { value: any } | undefined => {
    if (value === undefined) return { value };
    const next = structuredClone(value);
    try {
      applyOps(next, ops);
    } catch {
      return undefined;
    }
    return { value: next };
  };

  /** Lets go of whatever waits for `doc` to reach `v` or before. */
  const reached = (doc: string, v: number): void => {
    for (const w of waiting.get(doc)?.filter((w) => w.v <= v) ?? []) w.resolve();
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
     */
    async walk(way: "undo" | "redo", by: Writer, o: { dry?: boolean; entry?: number } = {}): Promise<Walked | null> {
      const answer = await local.as(by.identity).call(way, { cursor: by.cursor, ...o });
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

    /** Resolves when every change heard so far has been told. */
    async quiet(): Promise<void> {
      while (inflight.size > 0) await Promise.all([...inflight]);
    },

    /** Lets go of every held document but `keep`: closed in delta, dropped here. */
    async release(keep: Set<string>): Promise<void> {
      for (const doc of [...held.keys()]) {
        if (keep.has(doc)) continue;
        held.delete(doc);
        await local.call("close", { doc });
      }
    },

    /** Everything held, by name (for inspect and tests). */
    names: (): string[] => [...held.keys()],
  };

  /** The document as held, noting that the page being drawn read it; throws `Pending` when not held yet. */
  function heldAs(doc: string): Held {
    const { docType, docId } = splitDoc(doc);
    reading(docType, docId);
    const h = held.get(doc);
    if (!h) throw new Pending(doc);
    return h;
  }

  /** Waits until the held copy of `doc` has reached `version` -- at once in this process, after NOTIFY over Postgres. */
  function caughtUp(doc: string, version: number | undefined): Promise<void> {
    const h = held.get(doc);
    if (version === undefined || !h || h.v === undefined || h.v >= version) return Promise.resolve();
    return new Promise((resolve) => {
      const list = waiting.get(doc) ?? [];
      const w = { v: version, resolve: () => {
        waiting.set(doc, (waiting.get(doc) ?? []).filter((x) => x !== w));
        resolve();
      } };
      list.push(w);
      waiting.set(doc, list);
    });
  }
}

/** Runs `fn`; a read of a document not held yet loads it, and `fn` runs again. */
export async function settled<T>(documents: Documents | undefined, fn: () => T, tries = 20): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (e) {
      if (!(e instanceof Pending) || !documents || i >= tries) throw e;
      await documents.load(e.doc);
    }
  }
}

// The active example's documents, when it keeps them in delta: set by createServer, read by an
// example's views through `read`, one example per process as everywhere else in the kernel.
let active: Documents | undefined;

export function setActiveDocuments(documents: Documents | undefined): void {
  active = documents;
}

/** Reads a document from the active example's copy: `room:general`, `session:<id>`. */
export function read<T = any>(doc: string): T {
  if (!active) throw new Error("no documents: this example does not keep them in delta");
  return active.read<T>(doc);
}

/**
 * A document an applet watches, for its mount (`appletProps(props, watch("everyone:1", "/everyone"))`,
 * src/html.ts): its name, where it sits in the props, and the version it is held at as the page is
 * drawn -- the one `read` gives -- so the client passes over a patch the props already hold. Read
 * like any document, so the page is told its every change.
 */
export function watch(doc: string, under?: string): { doc: string; under?: string; v?: number } {
  if (!active) throw new Error("no documents: this example does not keep them in delta");
  const v = active.version(doc);
  return { doc, ...(under !== undefined && { under }), ...(v !== undefined && { v }) };
}

/** The active example's documents, when it keeps them in delta. */
export const activeDocuments = (): Documents | undefined => active;

/**
 * The server's own write -- to a live document it keeps true (who is here): no person, no cursor,
 * never on the ledger.
 */
export async function serverWrite(doc: string, ops: PatchOp[]): Promise<void> {
  if (!active) throw new Error("no documents: this example does not keep them in delta");
  const written = await active.write(doc, ops as DeltaOp[], { identity: undefined, cursor: "", undoable: false });
  if ("error" in written) throw new Error(`${doc}: ${written.error.message}`);
}

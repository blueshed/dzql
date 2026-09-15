import type { PatchOp } from "./json-patch";

// A story is told in the wire's own words: a session, a `{doc, ops}` message, and who then sees
// it where. See stories.md at the root. Nothing here runs; the harness that runs stories against
// a live example is the next thing to build, and it takes this shape as its input.

/** One message, exactly as the browser or the CLI would send it. */
export type Write = { doc: string; ops: PatchOp[] };

/** The cast: a session per name, and the writes that put it where the stories find it.
 * Every story starts from here: the cast is set up afresh per story, so no story depends on another. */
export type Cast = Record<string, Write[]>;

/** What a story tells, before it has a name. */
export type Told = { as: string } & (
  | {
      /** The write. Followed, when run, by its undo and its redo, with `seen` holding in reverse. */
      does: Write;
      /** Who should notice, and the compartment (by docType) on their page that shows it. */
      seen: Record<string, string>;
      /** Who must not notice. Everyone in the cast not named in `seen` is assumed here. */
      unseen?: string[];
    }
  | {
      /** A refusal: the permit table's other half. Nothing may change, and the ledger must not move. */
      cannot: Write;
    }
);

export type Stories = { cast: Cast; stories: Story[] };

export type Story = { name: string } & Told;

export function story(name: string, body: Told): Story {
  return { name, ...body };
}

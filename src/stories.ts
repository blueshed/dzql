import type { PatchOp } from "./json-patch";

// A story is told in the wire's own words: a session, a `{doc, ops}` message, and who then sees
// it, where. See stories.md at the root. `src/harness.ts` runs stories against a live example;
// this is the shape it takes as its input.

/** One message, exactly as the browser or the CLI would send it. */
export type Write = { doc: string; ops: PatchOp[] };

/** The cast: a session per name, and the writes that put it where the stories find it.
 * Every story starts from here: the cast is set up afresh per story, then the story's own premise
 * (the same shape), so no story depends on another. */
export type Cast = Record<string, Write[]>;

/**
 * Who should notice. A list names members and leaves them where the cast put them. A record
 * names, for each member, where they must be to notice -- a page, and whatever else the
 * example's `goTo` understands (a drawer open, a list reading) -- and the harness puts them there
 * before it looks, because a person sees only the page they are on, and a story says where its
 * change shows.
 */
export type Seen = string[] | Record<string, string>;

/** What a story tells, before it has a name. */
export type Told = {
  as: string;
  /**
   * What this story alone starts from: writes each named member of the cast makes, after the
   * cast's and before anything else in the story, rolled back with it -- a state the seed and the
   * cast do not have (the deadline passed, a wine already chosen), which would change every other
   * story if the cast made it. Made in the order written; each must land.
   */
  premise?: Cast;
} & (
  | {
      /**
       * The write the author makes. Their page must offer a control that sends it, and it must land.
       * The harness then undoes and redoes it, and checks each puts every page back.
       */
      does: Write;
      /** The address the author acts from: the drawer or modal that holds the control (`"2026-10?draft"`). Omitted: where `seen` or the cast put them. */
      from?: string;
      /** It comes from no page -- a feed, the CLI -- so no control is looked for. */
      offPage?: true;
      seen: Seen;
      /**
       * Who must not even be sent the document's changes, by the write, its undo or its redo.
       *
       * Stronger than being left out of `seen`: everyone not in `seen` is already checked to see no
       * change on their page. `untold` also checks that nothing was sent. Use it where a page reading
       * too much would leak (Cy, in the kitchen, is not sent general's messages).
       */
      untold?: string[];
    }
  | {
      /** A write that must be refused. Nothing may change, and the ledger must not move. */
      cannot: Write;
      /** The address the author tries it from, as for a `does`. */
      from?: string;
      /** What the refused person is told, beside the control that sent it (`refuse`, src/refusal.ts):
       * the one change their page may show. Omitted: they are told nothing. */
      told?: string;
    }
);

export type Story = { name: string } & Told;

export type Stories = {
  cast: Cast;
  /**
   * How a member of the cast signs in, when the example has people who must: the example's own
   * sign-in route and the form it takes. The harness posts it, as a browser would, and the member's
   * session is the one the answer's cookie names -- so a password never crosses the wire, and a
   * story starts from a signed-in page. Undefined for a member who stays a visitor.
   */
  signIn?: (name: string) => { path: string; form: Record<string, string> } | undefined;
  /**
   * The write that puts a person at an address: for `from`, and for the places in a `seen` record.
   * Leave's is `replace /page` on the session.
   *
   * - An address is the example's own: a page's address, then, after " @ ", anything else it understands.
   * - Where a page says where it stands (`data-page`), the harness checks the person got there.
   * - Omit it in an example with one page, where `seen` is a list of names.
   */
  goTo?: (address: string) => Write;
  stories: Story[];
};

export function story(name: string, body: Told): Story {
  return { name, ...body };
}

import type { PatchOp } from "./json-patch";

// A story is told in the wire's own words: a session, a `{doc, ops}` message, and who then sees
// it, where. See stories.md at the root. `src/harness.ts` runs stories against a live example;
// this is the shape it takes as its input.

/** One message, exactly as the browser or the CLI would send it. */
export type Write = { doc: string; ops: PatchOp[] };

/** The cast: a session per name, and the writes that put it where the stories find it.
 * Every story starts from here: the cast is set up afresh per story, so no story depends on another. */
export type Cast = Record<string, Write[]>;

/**
 * Who should notice. A list names members and leaves them where the cast put them. A record
 * names, for each member, where they must be to notice -- a page, and whatever else the
 * example's `at` understands (a drawer open, a list reading) -- and the harness puts them there
 * before it looks, because a person sees only the page they are on, and a story says where its
 * change shows.
 */
export type Seen = string[] | Record<string, string>;

/** What a story tells, before it has a name. */
export type Told = { as: string } & (
  | {
      /** The write. Followed, when run, by its undo and its redo, with `seen` holding in reverse.
       * The author's open page must offer a control that sends it (`data-write`), and it must land. */
      does: Write;
      /** Where the author stands to do it, in the example's own grammar (`Stories.at`): the drawer or
       * the modal that holds the control. Omitted: where `seen` or the cast put them. */
      from?: string;
      /** It comes from outside any page -- a feed, the CLI -- so no control is looked for. */
      outside?: true;
      seen: Seen;
      /** Who must not even be told: sent no document's ops, by the write, its undo or its redo.
       * Everyone not in `seen` must already notice nothing -- their page, where the cast left them,
       * the same -- so a story says everyone who sees it, counts on a home page included. */
      unseen?: string[];
    }
  | {
      /** A refusal: the permit table's other half. Nothing may change, and the ledger must not move. */
      cannot: Write;
      /** Where the author stands to try it, as for a `does`. */
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
  /** The write that puts a session where a `seen` record says -- the example's own grammar for
   * "where", a page at least. Omit in an example with one page, where `seen` lists names. */
  at?: (where: string) => Write;
  stories: Story[];
};

export function story(name: string, body: Told): Story {
  return { name, ...body };
}

import type { PatchOp } from "./json-patch";

// A story is told in the wire's own words: a session, a `{doc, ops}` message, and who then sees
// it, where. See stories.md at the root. `src/harness.ts` runs stories against a live example;
// this is the shape it takes as its input.

/** One message, exactly as the browser or the CLI would send it. The harness gives each an id of its own, as a page does, so what answers it -- its echo, or its refusal -- is its own. */
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

/**
 * What a person does on their page, where the page alone cannot say how: a tap at the middle of
 * what a CSS selector names (`press`), or a drag from the middle of the first to the middle of the
 * second (`drag`), as a mouse moves. An applet draws its own controls, so this is how a story says
 * how its control is worked: leave's calendar, dragged across two days.
 */
export type Gesture = { press: string } | { drag: [from: string, to: string] };

/**
 * What a story may cost on the wire: the most bytes its own step -- the write, the refusal or the
 * tab closing, not the undo and redo the harness adds -- may hand any one member's page, as the
 * page takes them (before compression). Over it, the story fails, naming the page and the biggest
 * part of what it was handed. A story's own budget stands in place of the example's.
 */
type Budgeted = { budget?: number };

/** A story that writes: `does`. */
type Does = Budgeted & {
  /**
   * The write the author makes. Their page must offer a control that sends it, and it must land.
   * The harness then undoes and redoes it, and checks each puts every page back.
   */
  does: Write;
  /** The address the author acts from: the drawer or modal that holds the control (`"2026-10?draft"`). Omitted: where `seen` or the cast put them. */
  from?: string;
  /** It comes from no page -- a feed, the CLI -- so no control is looked for. */
  offPage?: true;
  /**
   * How the author does it on their page. The story is then done by hand too, in a browser the
   * size of a phone, from where it starts: the gesture must send `does`, and it must land. Omitted:
   * by hand (`byHand`), the control the page draws for it is pressed, typed into or chosen.
   */
  gesture?: Gesture;
  seen: Seen;
  /**
   * Who must not even be sent the document's changes, by the write, its undo or its redo.
   *
   * Stronger than being left out of `seen`: everyone not in `seen` is already checked to see no
   * change on their page. `untold` also checks that nothing was sent. Use it where a page reading
   * too much would leak (Cy, in the kitchen, is not sent general's messages).
   */
  untold?: string[];
};

/** A story that is refused: `cannot`. */
type Cannot = Budgeted & {
  /** A write that must be refused. Nothing may change, and the ledger must not move. */
  cannot: Write;
  /** The address the author tries it from, as for a `does`. */
  from?: string;
  /** What the refused person is told, beside the control that sent it (`refuse`, src/refusal.ts):
   * the one change their page may show. Omitted: they are told nothing. */
  told?: string;
};

/** A story told by a socket going: `closesTab`. */
type ClosesTab = Budgeted & {
  /**
   * The author closes their tab: no write, the socket going, which the server tells like any
   * change (who is in a room). No control is looked for and nothing is undone; the author, gone,
   * sees nothing, so `seen` names only who is still looking.
   */
  closesTab: true;
  seen: Seen;
  /** Who must not even be sent a change by it, as for a `does`. */
  untold?: string[];
};

/**
 * The keys each kind of story takes, beside `name`, `as` and `premise`. A story is one kind, with
 * only that kind's keys: the types say so, and the harness refuses any other at run time too,
 * since a story file is not type-checked when it runs, and a key the harness does not read would
 * be dropped without a word (`{ does, closesTab }` would close a tab and never write).
 */
export const STORY_KEYS = {
  does: ["does", "from", "offPage", "gesture", "seen", "untold", "budget"],
  cannot: ["cannot", "from", "told", "budget"],
  closesTab: ["closesTab", "seen", "untold", "budget"],
} as const satisfies { does: readonly (keyof Does)[]; cannot: readonly (keyof Cannot)[]; closesTab: readonly (keyof ClosesTab)[] };

/** One kind of story, and none of another kind's keys. */
type Only<T> = T & { [K in Exclude<keyof Does | keyof Cannot | keyof ClosesTab, keyof T>]?: never };

/** What a story tells, before it has a name. */
export type Told = {
  as: string;
  /**
   * What this story alone starts from: writes each named member of the cast makes, after the
   * cast's and before anything else in the story, rolled back with it -- a state the seed and the
   * cast do not have (the deadline passed, a wine already chosen), which would change every other
   * story if the cast made it. Made in the order written; each must change something.
   */
  premise?: Cast;
} & (Only<Does> | Only<Cannot> | Only<ClosesTab>);

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
  /** The most bytes any story may hand any one member's page, as a story's own `budget` says it; a story with its own is held to that instead. */
  budget?: number;
  stories: Story[];
};

export function story(name: string, body: Told): Story {
  return { name, ...body };
}

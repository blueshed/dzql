import type { Story } from "../../src/modelling/stories";

// A test's own stories, told in the order given: `Stories.stories` keys each, and a test that
// picks a few of an example's (or makes its own) has no keys to give them.

/** `list` as `Stories.stories` holds them: each under its place in the list. */
export const keyed = (list: Story[]): Record<string, Story> => Object.fromEntries(list.map((s, i) => [`s${i}`, s]));

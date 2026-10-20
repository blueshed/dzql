// What this app was asked to make true: each a sentence someone using it could call true or false.
// A new story is written here first, under a key of its own, then made true by a test named from
// it (`test(`${stories.stories.saves.name} -- ...`)`): tests/stories.test.ts fails a story no test
// tells, so a story cannot be dropped or renamed away from its test. Earlier stories stay true.
//
// A story here is a sentence alone. When the app takes the step to dzql/rendering, a story gains a
// body (who does what, who then sees it), on the same line, under the same key, and the harness
// tells it: the cast is who does them.
import { story, type Stories } from "dzql/modelling/stories";

export const stories = {
  cast: {},
  stories: {
    // The move
    moved: story("The orders people made are still there after the app moves its documents to the next store."),
    // The kitchen
    kitchen: story("The cook sees each open order: a line added to any order, or changed, reaches the kitchen."),
    undo: story("Undo takes back your last change, wherever it shows."),
    // The order
    ordering: story("Someone ordering has the catalogue and their order on one page, with its total, and what one window orders shows in another."),
    // The message
    follows: story("Anyone who opens the page sees the message, and a change made anywhere else shows in it, with nothing to reload."),
    saves: story("Saving (the button, or Cmd+Enter or Ctrl+Enter in the box) says Saved once the server has it, and the message is still there after a reload."),
    refused: story("A save the server refuses says Not saved, and typing not yet saved is never overwritten by another window's save."),
    restarts: story("After the server restarts, the page has what changed meanwhile, and follows again."),
    // The server
    volume: story("The page says whether the data is on a mounted volume, never where it is."),
    health: story("The health check answers ok, and an unknown page links home."),
  },
} satisfies Stories;

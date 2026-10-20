// What this app was asked to make true: each a sentence someone using it could call true or false.
// A new story is written here first, then made true by a test named from it
// (`test(`${stories.saves.name} -- ...`)`): tests/stories.test.ts fails a story no test tells, so a
// story cannot be dropped or renamed away from its test. Earlier stories stay true.
//
// A story here is a sentence alone. When the app takes the step to dzql/rendering, a story gains a
// body (who does what, who then sees it) and the harness tells it.
import { story } from "dzql/modelling/stories";

export const stories = {
  // The message
  follows: story("Anyone who opens the page sees the message, and a change made anywhere else shows in it, with nothing to reload."),
  saves: story("Saving (the button, or Cmd+Enter or Ctrl+Enter in the box) says Saved once the server has it, and the message is still there after a reload."),
  refused: story("A save the server refuses says Not saved, and typing not yet saved is never overwritten by another window's save."),
  restarts: story("After the server restarts, the page has what changed meanwhile, and follows again."),
  // The server
  volume: story("The page says whether the data is on a mounted volume, never where it is."),
  health: story("The health check answers ok, and an unknown page links home."),
};

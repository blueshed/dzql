# Stories

What this app was asked to make true: each a sentence someone using it could call true or false.
A new story is written here first, then made true, with a test named for it. Earlier stories stay
true. Stories are numbered once through the file, so a number names one story.

## The message

1. Anyone who opens the page sees the message, and a change made anywhere else shows in it, with
   nothing to reload.
2. Saving (the button, or Cmd+Enter or Ctrl+Enter in the box) says Saved once the server has it,
   and the message is still there after a reload.
3. A save the server refuses says Not saved, and typing not yet saved is never overwritten by
   another window's save.
4. After the server restarts, the page has what changed meanwhile, and follows again.

## The server

5. The page says whether the data is on a mounted volume, never where it is.
6. The health check answers ok, and an unknown page links home.

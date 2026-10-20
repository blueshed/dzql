import { join, write } from "dzql/rendering/html";

// The session's part of the page: the name you go by, asked before anything else.

/** Without a name you cannot enter: the one form before anything else. */
export function renderNameForm(): string {
  return join(
    `<section class="door"><h1 class="cap">Chat</h1>`,
    `<form${write("session", "replace", "/name")}>`,
    `<label for="name" class="note">Your name</label>`,
    `<input id="name" name="name" autocomplete="off" autofocus required>`,
    `<button type="submit" class="tool">Continue</button>`,
    `</form></section>`,
  );
}

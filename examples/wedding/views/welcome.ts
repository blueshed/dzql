// The welcome: the save-the-date's own type and palette, the couple's own message if they have
// written one, their photograph if they have kept one, one code box, and a resend tucked behind a
// disclosure so the plain path -- enter a code -- stays the only thing offered. The two forms
// write the session; a code refused is said beside its box, and the note is what a resend says back.

import type { Wedding } from "../documents/wedding";
import { esc, join, write } from "./html";
import { formatDay, frame } from "./shared";

export function welcome(w: Wedding, note: string | null, refused = ""): string {
  return frame(
    true,
    join(
      `<section class="hero">`,
      `<p class="kicker">Save the date for</p><p class="kicker">The marriage of</p>`,
      `<p class="names">${esc(w.name1)}</p><span class="amp">&amp;</span><p class="names">${esc(w.name2)}</p>`,
      `<p class="when">${esc(formatDay(w.day))}</p>`,
      w.venue && `<p class="where">${esc(w.venue)}</p>`,
      w.message && `<p class="message">${esc(w.message)}</p>`,
      `<p class="small">( formal invitations to follow )</p>`,
      `</section>`,
      w.picture_key && `<section class="photo-card"><img class="welcome-pic" src="/pictures/${esc(w.picture_key)}" alt="${esc(`${w.name1} and ${w.name2}`)}"></section>`,
      `<section class="card enter-card"><h2>Open our household</h2>`,
      `<form class="row"${write("session", "replace", "/code")}>`,
      `<input class="field" id="code" name="code" type="text" placeholder="Your code" autocomplete="off" autocapitalize="characters" aria-label="Your household or couple code" required>`,
      `<button class="gold" type="submit">Open our household</button></form>`,
      refused,
      `<p class="note" id="welcome-status">${esc(note ?? "")}</p>`,
      `<details class="resend"><summary>Lost the email? Send it again</summary>`,
      `<form class="row"${write("session", "replace", "/resend")}>`,
      `<input class="field" name="email" type="email" placeholder="The address it came to" autocomplete="off" required>`,
      `<button class="ghost" type="submit">Send it again</button></form></details>`,
      `</section>`,
    ),
  );
}

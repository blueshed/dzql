import { esc, join } from "dzql/rendering/html";
import { icon } from "../../icons";

// Nobody yet: this is a demo, so in development the door is a way in for everyone. The staff come
// in by their links (the ones `bun dev` prints, ../../routes.ts), listed only in development: in
// production there are none (dzql/rendering/links), and the staff come in another way. A customer
// comes in by the code on their table, a button here for each.

/** The door: each of the staff's link, when there are any (development), and each table's code. */
export function door(staff: { name: string; path: string }[], tables: { id: string; name: string }[]): string {
  const wayIn = (t: { id: string; name: string }) => `<form method="post" action="/scan"><input type="hidden" name="table" value="${esc(t.id)}"><button type="submit" class="tool">${icon("armchair")}${esc(t.name)}</button></form>`;
  return join(
    `<section class="door"><h1 class="cap">${icon("coffee", 20)} The cafe</h1>`,
    staff.length > 0 && `<p>Come in as one of the staff:</p>`,
    staff.length > 0 && `<nav class="ways-in" aria-label="Staff">${join(...staff.map((s) => `<a class="tool" href="${esc(s.path)}">${icon(/cook/.test(s.name) ? "chef-hat" : "bell")}${esc(s.name)}</a>`))}</nav>`,
    `<p>Or scan the code on your table to see the menu and order:</p>`,
    `<nav class="ways-in" aria-label="Tables">${join(...tables.map(wayIn))}</nav>`,
    `</section>`,
  );
}

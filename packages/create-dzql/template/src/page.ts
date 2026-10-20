import { layers } from "dzql/rendering/bento";
import { icon } from "./icons";

// Starter's page: nothing yet but where to begin. The server draws every page (./routes.ts), for a
// session where one of its tabs stands (`render(sessionId, address)`: the address is the tab's own,
// its URL, once a story needs places); a page is the bento's (`bento({ icon, session })`:
// `collectionPage` or `boxPage`, `rows` of `row`s, `tool`s, in `layers()`), its marks lucide's
// (./icons.ts) -- the dzql-app skill's page and bento.
export function render(): string {
  return layers(
    `<section class="door"><h1 class="cap">${icon("sprout", 20)} Starter</h1><p>Nothing here yet. Tell the first story: who does what, and who then sees it. It is modelled as you tell it, and built here.</p></section>`,
    "",
    "",
  );
}

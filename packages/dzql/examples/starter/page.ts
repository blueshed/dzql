import { layers } from "../../src/bento";

// Starter's page: nothing yet but where to begin. The server draws every page (src/server.ts);
// the bento's surfaces (src/bento.ts) are how a page looks once there is something on it.
export function render(): string {
  return layers(
    `<section class="door"><h1 class="cap">Starter</h1><p>Nothing here yet. Tell the first story: who does what, and who then sees it. It is modelled as you tell it, and built here.</p></section>`,
    "",
    "",
  );
}

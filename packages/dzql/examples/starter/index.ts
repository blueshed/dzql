import type { Example } from "../../src/example";
import { render } from "./page";
import index from "./client/index.html";
import { delta } from "./delta";

// Starter: the app a project made with `bun create blueshed/eta` begins as -- nothing yet but its
// page. Its stories come first (./stories.ts), modelled as they are told (the modelling skill, and
// the model's page), then built here, the least that makes each pass (the eta-app skill).
export const example: Example = {
  name: "starter",
  compartments: [],
  render,
  active: () => false, // nobody writes anything yet
  index,
  delta,
};

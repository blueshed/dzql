import type { PatchOp } from "../../src/json-patch";

// modeling's own short verbs, loaded by src/cli.ts (ETA_EXAMPLE=modeling) after the kernel's own
// (inspect, watch, undo, redo, write): how Claude keeps the model while Peter tells it. Each builds
// a write to the model and nothing else -- no database here. The CLI signs in as the page does,
// by posting the sign-in form, and keeps the session it is given in its session file:
//
//   curl -si -d email=claude@modeling.example -d password=... http://localhost:3005/login \
//     | sed -n 's/.*session_id=\([^;]*\).*/\1/p' > .eta-session
//
//   bun run cli story Ann asks for a week off          a story, written down
//   bun run cli reword 1 Ann asks for a week in October
//   bun run cli unsay 2                                a story taken back
//   bun run cli document calendar 1 3                  a document, for stories 1 and 3
//   bun run cli holds 1 Request starts:date ends:date status
//   bun run cli unhold 1 Request
//   bun run cli heldby 1 Ann Bo Mo
//   bun run cli serves 1 1 2
//   bun run cli rename 1 team
//   bun run cli drop 2                                 a document taken out

type Write = { doc: string; ops: PatchOp[] };
const model = (op: PatchOp): Write => ({ doc: "model", ops: [op] });
const field = (said: string) => ({ name: said.split(":")[0]!, type: said.split(":")[1] ?? "text" });

export const aliases: Record<string, (args: string[]) => Write> = {
  story: (args) => model({ op: "add", path: "/stories/-", value: args.join(" ") }),
  reword: ([id, ...words]) => model({ op: "replace", path: `/stories/${id}/text`, value: words.join(" ") }),
  unsay: ([id]) => model({ op: "remove", path: `/stories/${id}` }),
  document: ([name, ...stories]) => model({ op: "add", path: "/documents/-", value: { name, stories } }),
  holds: ([id, entity, ...fields]) => model({ op: "replace", path: `/documents/${id}/holds/${entity}`, value: fields.map(field) }),
  unhold: ([id, entity]) => model({ op: "remove", path: `/documents/${id}/holds/${entity}` }),
  heldby: ([id, ...who]) => model({ op: "replace", path: `/documents/${id}/held_by`, value: who }),
  serves: ([id, ...stories]) => model({ op: "replace", path: `/documents/${id}/stories`, value: stories }),
  rename: ([id, ...name]) => model({ op: "replace", path: `/documents/${id}/name`, value: name.join(" ") }),
  drop: ([id]) => model({ op: "remove", path: `/documents/${id}` }),
};

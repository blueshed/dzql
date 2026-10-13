import type { PatchOp } from "../../src/json-patch";

// modeling's own short verbs, loaded by src/cli.ts (ETA_EXAMPLE=modeling) after the kernel's own
// (inspect, watch, undo, redo, write): how Claude keeps the model while Peter tells it. Each builds
// a write to the model and nothing else -- no database here. The CLI signs in as the page does,
// by posting the sign-in form, and keeps the session it is given in its session file:
//
//   curl -si -d email=claude@modeling.example -d password=... http://localhost:3005/login \
//     | sed -n 's/.*session_id=\([^;]*\).*/\1/p' > .eta-session
//
//   bun run cli story ann does Ann asks for a week off        a story: who tells it, does or cannot, its words
//   bun run cli story visitor does --post /login Bo signs in   one that posts a form to a route
//   bun run cli reword 1 Ann asks for a week in October
//   bun run cli touches 1 requests teams                  the entities a story touches
//   bun run cli unsay 2                                   a story taken back
//   bun run cli document team teams 2 4 5                 a document: its name, its root, the stories it serves
//   bun run cli own 2                                     each person's own (a session), not shared
//   bun run cli holds 1 requests under teams starts:date ends:date status
//   bun run cli unhold 1 requests
//   bun run cli heldby 1 ann bo mo
//   bun run cli serves 1 2 4 5
//   bun run cli rename 1 team
//   bun run cli drop 2                                    a document taken out

type Write = { doc: string; ops: PatchOp[] };
const model = (op: PatchOp): Write => ({ doc: "model", ops: [op] });
const field = (said: string) => ({ name: said.split(":")[0]!, type: said.split(":")[1] ?? "text" });

/** A story's words, and the route it posts to when `--post <path>` is among them. */
function told(words: string[]): { text: string; post?: string } {
  const at = words.indexOf("--post");
  if (at < 0) return { text: words.join(" ") };
  return { text: [...words.slice(0, at), ...words.slice(at + 2)].join(" "), post: words[at + 1] };
}

export const aliases: Record<string, (args: string[]) => Write> = {
  story: ([actor, kind, ...words]) => model({ op: "add", path: "/stories/-", value: { actor, kind, ...told(words) } }),
  reword: ([id, ...words]) => model({ op: "replace", path: `/stories/${id}/text`, value: words.join(" ") }),
  touches: ([id, ...entities]) => model({ op: "replace", path: `/stories/${id}/touches`, value: entities }),
  unsay: ([id]) => model({ op: "remove", path: `/stories/${id}` }),
  document: ([name, root, ...stories]) => model({ op: "add", path: "/documents/-", value: { name, root, stories } }),
  own: ([id]) => model({ op: "replace", path: `/documents/${id}/own`, value: true }),
  holds: ([id, entity, ...rest]) => {
    const under = rest[0] === "under" ? rest[1] : undefined;
    return model({ op: "replace", path: `/documents/${id}/holds/${entity}`, value: { under, fields: (under ? rest.slice(2) : rest).map(field) } });
  },
  unhold: ([id, entity]) => model({ op: "remove", path: `/documents/${id}/holds/${entity}` }),
  heldby: ([id, ...who]) => model({ op: "replace", path: `/documents/${id}/held_by`, value: who }),
  serves: ([id, ...stories]) => model({ op: "replace", path: `/documents/${id}/stories`, value: stories }),
  rename: ([id, ...name]) => model({ op: "replace", path: `/documents/${id}/name`, value: name.join(" ") }),
  drop: ([id]) => model({ op: "remove", path: `/documents/${id}` }),
};

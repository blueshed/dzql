import { readFileSync } from "node:fs";
import { extractSessionFile, savedServer, type Aliases } from "dzql/rendering/cli/commands";
import type { PatchOp } from "dzql/rendering/json-patch";
import { closureOf, plainClosure } from "./closure";
import { plain } from "./heart";

// modeling's own short verbs, loaded by src/cli.ts (ETA_EXAMPLE=modeling) after the kernel's own
// (inspect, watch, undo, redo, write): how Claude keeps the model while Peter tells it. Each builds
// a write to the model and nothing else -- no database here -- but `show`, which reads it. The CLI
// signs in as the page does, by posting the sign-in form, and keeps the session it is given in its
// session file:
//
//   curl -si -d email=claude@modeling.example -d password=... http://localhost:3005/login \
//     | sed -n 's/.*session_id=\([^;]*\).*/\1/p' > .eta-session
//
//   bun run cli story ann does Ann asks for a week off        a story: who tells it, does or cannot, its words
//   bun run cli story visitor does --post /login Bo signs in   one that posts a form to a route
//   bun run cli story ann does "Ann scans the table's QR code"  words with an apostrophe: in double quotes,
//   echo "Ann scans the table's QR code" | bun run cli story ann does -   or piped in: `-` reads them
//   bun run cli reword 1 Ann asks for a week in October
//   bun run cli teller 1 mo                                  who tells it, its number kept
//   bun run cli touches 1 requests teams                  the entities a story touches
//   bun run cli writes 1 add requests                     what a story writes, as hjeli had it: an entity and a verb,
//   bun run cli writes 10 replace requests.status=approved   and for a replace the field and the value it sets
//   bun run cli requires 10 requests.status=waiting       the states a story presupposes
//   bun run cli unsay 2                                   a story taken back
//   bun run cli document team teams 2 4 5                 a document: its name, its root, the stories it serves
//   bun run cli own 2                                     each person's own (a session), not shared
//   bun run cli list 3                                    every row of its root (`menu:`), not one (`menu:1`)
//   bun run cli holds 1 requests under teams starts:date ends:date status
//   bun run cli unhold 1 requests
//   bun run cli heldby 1 ann bo mo
//   bun run cli serves 1 2 4 5
//   bun run cli rename 1 team
//   bun run cli drop 2                                    a document taken out
//   bun run cli show                                      the model as its page shows it, in plain text, and hjeli's six registers over it

type Write = { doc: string; ops: PatchOp[] };
const model = (op: PatchOp): Write => ({ doc: "model", ops: [op] });
const field = (said: string) => ({ name: said.split(":")[0]!, type: said.split(":")[1] ?? "text" });

/** Where `-` reads a story's words from: what is piped in. */
export const stdin = { path: "/dev/stdin" };

/** A story's words as said, or, said as `-`, as piped in: then an apostrophe needs no shell quote, which, left open, would run the commands after it into one story. */
const said = (words: string[]): string => (words.length === 1 && words[0] === "-" ? readFileSync(stdin.path, "utf8").trim() : words.join(" "));

/** A story's words, and the route it posts to when `--post <path>` is among them. */
function told(words: string[]): { text: string; post?: string } {
  const at = words.indexOf("--post");
  if (at < 0) return { text: said(words) };
  return { text: said([...words.slice(0, at), ...words.slice(at + 2)]), post: words[at + 1] };
}

/** `add requests`, `replace requests.status=approved`, ...: a story's writes, a verb and its target each. */
function writesSaid(words: string[]) {
  const writes = [];
  for (let i = 0; i < words.length; i += 2) {
    const [, entity, path, to] = (words[i + 1] ?? "").match(/^([^.=]+)(?:\.([^=]+))?(?:=(.*))?$/) ?? [];
    writes.push({ op: words[i], entity, ...(path && { path }), ...(to !== undefined && { to }) });
  }
  return writes;
}

/** `requests.status=waiting`, ...: the states a story presupposes. */
const requiresSaid = (words: string[]) =>
  words.map((w) => {
    const [, entity, path, value] = w.match(/^([^.=]+)\.([^=]+)=(.*)$/) ?? [];
    return { entity, path, value };
  });

export const aliases: Aliases = {
  story: ([actor, kind, ...words]) => model({ op: "add", path: "/stories/-", value: { actor, kind, ...told(words) } }),
  reword: ([id, ...words]) => model({ op: "replace", path: `/stories/${id}/text`, value: said(words) }),
  teller: ([id, actor]) => model({ op: "replace", path: `/stories/${id}/actor`, value: actor }),
  touches: ([id, ...entities]) => model({ op: "replace", path: `/stories/${id}/touches`, value: entities }),
  writes: ([id, ...words]) => model({ op: "replace", path: `/stories/${id}/writes`, value: writesSaid(words) }),
  requires: ([id, ...words]) => model({ op: "replace", path: `/stories/${id}/requires`, value: requiresSaid(words) }),
  unsay: ([id]) => model({ op: "remove", path: `/stories/${id}` }),
  document: ([name, root, ...stories]) => model({ op: "add", path: "/documents/-", value: { name, root, stories } }),
  own: ([id]) => model({ op: "replace", path: `/documents/${id}/own`, value: true }),
  list: ([id]) => model({ op: "replace", path: `/documents/${id}/list`, value: true }),
  root: ([id, entity]) => model({ op: "replace", path: `/documents/${id}/root`, value: entity }),
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

/**
 * `show`: the model as its page shows it, in plain text (./heart.ts `plain`), and hjeli's six registers
 * over it (./closure.ts), read as the session
 * file's person reads the page; or why there is none to read. A read, not a write, so it is
 * answered here, as the kernel's CLI loads this file, before it looks for a write: the exit code.
 */
export async function show(url: string, sessionFile: string): Promise<number> {
  const { readPage } = await import("./loader/told"); // only for `show`: a write needs none of it
  const session = (await Bun.file(sessionFile).text().catch(() => "")).trim();
  try {
    const page = await readPage(url, session);
    console.log(`${plain(page)}\n\n${plainClosure(closureOf(page))}`);
    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
}

const { sessionFile, rest } = extractSessionFile(process.argv.slice(2));
if (rest[0] === "show") process.exit(await show(process.env.ETA_URL ?? savedServer(sessionFile) ?? "ws://localhost:3000", sessionFile));

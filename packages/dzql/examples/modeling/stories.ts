import { story, type Stories, type Write } from "dzql/modelling/stories";

// Modeling is a description of an application that two people keep while they talk: Peter tells
// the stories, and Claude writes them down -- who tells each, whether they do it or are refused,
// what it touches -- and describes the documents they need: each one's root, what it holds and what
// that hangs under, who holds it, which stories it serves. The entities are worked out from those,
// never written. Claude writes from the CLI (`bun run cli`, ./cli.ts); Peter watches the page, the
// modeller's three columns, live: each change drawn as it lands, and the gaps as they open -- a
// story no document serves, an entity needed by no story, one looked up and never held -- and above
// them hjeli's six registers, run on the model after every change (./closure.ts).
//
// The seed: leave's model, as the modeller read it from leave's code and a run of its 23 stories:
// the team (1, rooted at teams, holding people and requests, held by ann, bo and mo) for the stories
// about requests and people, and each person's own session (2) for 1, 3, 20 and 23; the logins a
// sign-in looks up (stories 21 and 22) no document holds. Peter and Claude have signed in; a
// visitor has the link and has not.
//
// Next, once these pass: the model built into an app that runs these same stories, each shown
// passing or failing beside it.

const model = (...ops: Write["ops"]): Write => ({ doc: "model", ops });
const tell = (text: string, actor = "bo", kind = "does"): Write => model({ op: "add", path: "/stories/-", value: { text, actor, kind } });
const reword = (id: number, text: string): Write => model({ op: "replace", path: `/stories/${id}/text`, value: text });
const touches = (id: number, entities: string[]): Write => model({ op: "replace", path: `/stories/${id}/touches`, value: entities });
const unsay = (id: number): Write => model({ op: "remove", path: `/stories/${id}` });
const describe = (name: string, root: string, stories: string[]): Write => model({ op: "add", path: "/documents/-", value: { name, root, stories } });
const holds = (document: number, entity: string, under: string, fields: string[]): Write =>
  model({ op: "replace", path: `/documents/${document}/holds/${entity}`, value: { under, fields: fields.map((f) => ({ name: f.split(":")[0], type: f.split(":")[1] ?? "text" })) } });
const unhold = (document: number, entity: string): Write => model({ op: "remove", path: `/documents/${document}/holds/${entity}` });
const heldBy = (document: number, who: string[]): Write => model({ op: "replace", path: `/documents/${document}/held_by`, value: who });
const serves = (document: number, stories: string[]): Write => model({ op: "replace", path: `/documents/${document}/stories`, value: stories });
const drop = (document: number): Write => model({ op: "remove", path: `/documents/${document}` });

export const stories: Stories = {
  cast: { peter: [], claude: [], visitor: [] },
  signIn: (name) => (name === "visitor" ? undefined : { path: "/login", form: { email: `${name}@modeling.example`, password: `${name}-password` } }),
  stories: [
    // ── the stories ──
    story("Claude writes down a story Peter told, and Peter sees it arrive, with no document yet", { as: "claude", does: tell("Bo moves his week to the one after, before Mo has answered"), offPage: true, seen: ["peter", "claude"] }),
    story("Claude rewords a story as Peter corrects it, and Peter sees the new words", { as: "claude", does: reword(6, "Bo takes back his week in October, before Mo has answered it"), offPage: true, seen: ["peter", "claude"] }),
    story("Claude says signing in touches the sessions too, and Peter sees the story light them", { as: "claude", does: touches(21, ["logins", "sessions"]), offPage: true, seen: ["peter", "claude"] }),
    story("A story with no words cannot be written down", { as: "claude", cannot: tell("  "), told: "A story needs words." }),
    story("Claude cannot write a story whose words run onto a second line", { as: "claude", cannot: tell("Ann scans the table's QR code\nbun run cli:model story ann does Ann orders a coffee"), told: "A story is one line: these words run onto a second." }),

    // ── the documents ──
    story("Claude describes a document a story needs, and Peter sees it beside the story it serves", { as: "claude", does: describe("calendar", "requests", ["2"]), offPage: true, seen: ["peter", "claude"] }),
    story("Claude says the team holds its holidays, and Peter sees a new entity hang from teams", { as: "claude", does: holds(1, "holidays", "teams", ["date:date", "name"]), offPage: true, seen: ["peter", "claude"] }),
    story("Claude says who holds the team, and Peter sees who it is for", { as: "claude", does: heldBy(1, ["ann", "bo", "mo", "jo"]), offPage: true, seen: ["peter", "claude"] }),
    story("A document that serves no story cannot be described", { as: "claude", cannot: describe("notes", "notes", []), told: "A document is for a story: name the one it serves." }),
    story("A document keeps its root", { as: "claude", cannot: unhold(1, "teams"), told: "A document keeps its root: take the document out instead." }),

    // ── the entities, worked out ──
    story("Claude takes back the last story the session serves, and Peter sees the sessions needed by no story", { as: "claude", premise: { claude: [serves(2, ["23"])] }, does: unsay(23), offPage: true, seen: ["peter", "claude"] }),
    story("Claude takes out the session, and Peter sees the sessions looked up, held by no document", { as: "claude", does: drop(2), offPage: true, seen: ["peter", "claude"] }),

    // ── hjeli's six registers, run as the model is told ──
    story("Claude says a story touches the rotas, which no document holds, and Peter sees reachability open", { as: "claude", does: touches(2, ["requests", "rotas"]), offPage: true, seen: ["peter", "claude"] }),

    // ── who may ──
    story("A visitor who has not signed in cannot write a story down", { as: "visitor", cannot: tell("I would like a day off") }),
  ],
};

import { story, type Stories, type Write } from "../../src/stories";

// Modeling is a description of an application that two people keep while they talk: Peter tells
// the stories, and Claude writes them down, describes the documents they need, and says what each
// holds and who holds it. The entities are worked out from the documents, never written. Claude
// writes from the CLI (`bun run cli`, ./cli.ts); Peter watches the page, which shows each change as
// it lands, and the gaps as they open: a story no document serves, a document no story needs, an
// entity held only by such documents. The model is a delta document, so every change undoes.
//
// The seed: one model, "Leave", with two stories (1: "Ann asks for a week off, and Mo sees it
// waiting"; 2: "Mo approves Ann's week, and Ann sees it approved") and two documents: 1, team,
// holding Person and Request, held by Ann, Bo and Mo, for both stories; 2, inbox, holding Request,
// held by Mo, for the second. Peter and Claude have signed in; a visitor has the link and has not.
//
// Next, once these pass: the model built into an app that runs these same stories, each shown
// passing or failing beside it.

const model = (...ops: Write["ops"]): Write => ({ doc: "model", ops });
const tell = (text: string): Write => model({ op: "add", path: "/stories/-", value: text });
const reword = (id: number, text: string): Write => model({ op: "replace", path: `/stories/${id}/text`, value: text });
const unsay = (id: number): Write => model({ op: "remove", path: `/stories/${id}` });
const describe = (name: string, stories: string[]): Write => model({ op: "add", path: "/documents/-", value: { name, stories } });
const holds = (document: number, entity: string, fields: string[]): Write =>
  model({ op: "replace", path: `/documents/${document}/holds/${entity}`, value: fields.map((f) => ({ name: f.split(":")[0], type: f.split(":")[1] ?? "text" })) });
const heldBy = (document: number, who: string[]): Write => model({ op: "replace", path: `/documents/${document}/held_by`, value: who });
const drop = (document: number): Write => model({ op: "remove", path: `/documents/${document}` });
const pick = (what: string): Write => ({ doc: "session", ops: [{ op: "replace", path: "/chosen", value: what }] });

export const stories: Stories = {
  cast: { peter: [], claude: [], visitor: [] },
  signIn: (name) => (name === "visitor" ? undefined : { path: "/login", form: { email: `${name}@modeling.example`, password: `${name}-password` } }),
  stories: [
    // ── the stories ──
    story("Claude writes down a story Peter told, and Peter sees it arrive, with no document yet", { as: "claude", does: tell("Bo takes back his week before Mo has answered"), offPage: true, seen: ["peter", "claude"] }),
    story("Claude rewords a story as Peter corrects it, and Peter sees the new words", { as: "claude", does: reword(1, "Ann asks for a week off in October, and Mo sees it waiting"), offPage: true, seen: ["peter", "claude"] }),
    story("A story with no words cannot be written down", { as: "claude", cannot: tell("  "), told: "A story needs words." }),

    // ── the documents ──
    story("Claude describes a document a story needs, and Peter sees it beside the story it serves", { as: "claude", does: describe("calendar", ["1"]), offPage: true, seen: ["peter", "claude"] }),
    story("Claude says what a document holds, and Peter sees a new entity appear", { as: "claude", does: holds(1, "Holiday", ["date:date", "name"]), offPage: true, seen: ["peter", "claude"] }),
    story("Claude says who holds a document, and Peter sees who is told of its changes", { as: "claude", does: heldBy(2, ["Mo", "Bo"]), offPage: true, seen: ["peter", "claude"] }),
    story("A document that serves no story cannot be described", { as: "claude", cannot: describe("notes", []), told: "A document is for a story: name the one it serves." }),

    // ── the entities, worked out ──
    story("Claude takes back the second story, and Peter sees the inbox, needed by no story now", { as: "claude", does: unsay(2), offPage: true, seen: ["peter", "claude"] }),
    story("Claude takes out the inbox, and Peter sees Request stay, held by the team", { as: "claude", does: drop(2), offPage: true, seen: ["peter", "claude"] }),
    story("Claude takes out the team, and Peter sees Person go, held by nothing now", { as: "claude", does: drop(1), offPage: true, seen: ["peter", "claude"] }),

    // ── what goes with what ──
    story("Peter picks the inbox, and sees the story it serves and the entity it holds", { as: "peter", does: pick("document:2"), seen: ["peter"], untold: ["claude"] }),

    // ── who may ──
    story("A visitor who has not signed in cannot write a story down", { as: "visitor", cannot: tell("I would like a day off") }),
  ],
};

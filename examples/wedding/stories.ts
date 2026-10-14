// The wedding, told as stories: who does what, and who then sees it, where. See docs/stories.md at the
// root. Ids are the seed's (seed.sql): the Okafors are household 1 with guests 1
// (Ada) and 2 (Femi), one plus-one still to name, and one open ask (1, Kemi); Ben is household 2
// with guest 3 and no plus-one; gifts are 1 (casserole), 2 (the honeymoon fund, shared) and 3
// (knives); course 2 is the main, with dish 5 (sea bass) and drink 3 (Rioja). Paths name rows by
// id, never by position.
//
// Where: the page's address -- the page, and after a `?` the one thing open over it -- and after
// " @ ", what find is looking for (`filter.guests=Femi`). A household's page is its
// photo: "" (the household, with a waiting ask as a ghost), "list" (the same people as a list) or
// "everyone" (the photo every household watches); over it, a guest's drawer (`?guest=2`),
// the answer's (`?answer`), the plus's modal (`?new=guests` names a plus-one, `?new=asks` asks the
// couple), and the information a household reads and puts away: `?gifts`, `?day`, `?stay`. The
// couple's page is the photo of every family: "" (with the welcome over it) or "list"; over it, a
// family's drawer (`?family=1`), the welcome's (`?answer`), the four lists they keep (`?courses`,
// `?gifts`, `?events`, `?places`) and a row of one (`?keep=courses/1`), and the modals that invite
// (`?new=households`) and take off (`?confirm=courses/4`, `?confirm=households/2/guests/3`). The
// venues they are choosing between are a page of their own, drawn from the venues' shape with no
// view written for it (src/derive.ts): "venues", a venue's drawer (`venues?row=1`), and the modals
// that add one (`venues?new`) and cross one off (`venues?confirm=1`).
import { goTo as goToOn, story, type Stories, type Write } from "../../src/stories";

const session = (path: string, value?: unknown): Write => ({
  doc: "session",
  ops: [value === undefined ? { op: "remove", path } : { op: "replace", path, value }],
});
const household = (op: "add" | "replace" | "remove", path: string, value?: unknown): Write => ({
  doc: "household",
  ops: [op === "remove" ? { op, path } : { op, path, value }],
});
const board = (op: "add" | "replace" | "remove", path: string, value?: unknown): Write => ({
  doc: "board",
  ops: [op === "remove" ? { op, path } : { op, path, value }],
});
/** A household's field typed in, as its editing form sends it: the value it was drawn with when the typing began (RFC 6902's `test`), then what is typed. */
const typed = (path: string, was: string, value: string): Write => ({ doc: "household", ops: [{ op: "test", path, value: was }, { op: "replace", path, value }] });

/** Where someone stands, as one write to the session (`goTo`, src/stories.ts). */
const goTo = goToOn("session");

export const stories: Stories = {
  cast: {
    couple: [session("/code", "DASH")],
    okafors: [session("/code", "OKAFOR")],
    ben: [session("/code", "BEN")],
    benToo: [session("/code", "BEN")], // Ben's household, a second tab
    stranger: [],
  },
  goTo,
  stories: [
    // ── Coming in ──
    story("A household enters its code, and is on its page", { as: "stranger", does: session("/code", "OKAFOR"), seen: ["stranger"] }),
    story("A stranger types a code nobody has, and is told it was not recognised", { as: "stranger", cannot: session("/code", "NOPE"), told: "That code was not recognised." }),

    // ── The couple keep the wedding ──
    story("The couple invite the Londons, Jo and Sam, and they are on the list", { as: "couple", from: "list?new=households", does: board("add", "/households/-", { email: "londons@example.com", names: "Jo London, Sam London", plus_ones: 2 }), seen: { couple: "list" } }),
    story("The couple set a deadline, and the households see it", { as: "couple", from: "?answer", does: board("replace", "/deadline", "2027-03-01"), seen: { couple: "", okafors: "", ben: "", benToo: "" } }),
    story("The couple change their message, and every welcome changes", { as: "couple", from: "?answer", does: board("replace", "/message", "See you in April."), seen: { couple: "?answer", stranger: "" } }),

    // ── A household answers, and asks ──
    story("The Okafors say maybe, and the couple's photo and everyone's change", { as: "okafors", does: household("replace", "/answer", "maybe"), seen: { okafors: "?answer", couple: "", benToo: "everyone" }, undone: "Undone: your answer.", redone: "Redone: your answer." }),
    story("Femi is not coming after all: the mark at his feet says so, and he leaves everyone's photo", { as: "okafors", from: "?guest=2", does: household("replace", "/guests/2/coming", "0"), seen: { okafors: "", couple: "", benToo: "everyone" } }),
    story("The Okafors leave the caterer a note, and only the couple read it", { as: "okafors", from: "?answer", does: household("replace", "/message", "Ada is vegetarian."), seen: { okafors: "", couple: "?family=1" }, untold: ["ben", "benToo"] }),
    story("Ben is writing his note on his phone when he changes it on his laptop; the phone is told, and its next keystroke does not write over the laptop's unseen", { as: "ben", premise: { benToo: [household("replace", "/message", "Can I bring the dog?")] }, from: "?answer", cannot: typed("/message", "", "See you there."), told: "This was changed elsewhere as you typed: here it is now." }),
    story("The Okafors bring a plus-one, and the couple see the name", { as: "okafors", from: "?new=guests", does: household("add", "/guests/-", "Tolu Adebayo"), seen: { okafors: "", couple: "?family=1", benToo: "everyone" }, undone: "Undone: bringing Tolu Adebayo.", redone: "Redone: bringing Tolu Adebayo." }),
    story("Ben, with no plus-one, asks to bring his sister, and she stands in his photo as a ghost until the couple answer", { as: "ben", from: "?new=asks", does: household("add", "/asks/-", "Lotte Achterberg"), seen: { ben: "", benToo: "", couple: "?family=2" } }),
    story("The couple say yes to Kemi, and she is a guest in the Okafors' photo", { as: "couple", from: "?family=1", does: board("replace", "/households/1/asks/1/reply", "yes"), seen: { couple: "?family=1", okafors: "", benToo: "everyone" } }),
    story("Once the deadline has passed, the Okafors cannot change their answer", { as: "okafors", premise: { couple: [board("replace", "/deadline", "2026-01-01")] }, from: "?answer", cannot: household("replace", "/answer", "maybe") }),

    // ── The meal and the gifts ──
    story("Femi picks the sea bass, and the couple see it in the Okafors' drawer", { as: "okafors", from: "list?guest=2", does: household("replace", "/guests/2/choices/2/dish", 5), seen: { okafors: "list", couple: "?family=1" } }),
    story("The couple offer a vegan main", { as: "couple", from: "?keep=courses/2", does: board("add", "/courses/2/dishes/-", { name: "Aubergine tagine", dietary: "vg, gf" }), seen: { couple: "?keep=courses/2", okafors: "?guest=2", ben: "?guest=3" } }),
    story("The couple add a gift, and it is on every list", { as: "couple", from: "?gifts", does: board("add", "/gifts/-", { name: "A tree for the garden", description: "A crab apple." }), seen: { couple: "?gifts", okafors: "?gifts", ben: "?gifts" } }),
    story("The Okafors claim the casserole, and it leaves Ben's list", { as: "okafors", from: "?gifts", does: household("add", "/claims/-", 1), seen: { okafors: "?gifts", couple: "?gifts", ben: "?gifts" } }),

    // ── The day, and where to stay ──
    story("The couple add an event to the day", { as: "couple", from: "?events", does: board("add", "/events/-", { name: "Fireworks", when_at: "2027-04-02T22:00" }), seen: { couple: "?events", okafors: "?day", ben: "?day" } }),
    story("The couple add somewhere to stay", { as: "couple", from: "?places", does: board("add", "/places/-", { name: "The Bristol Hotel", notes: "Ask for the wedding rate." }), seen: { couple: "?places", okafors: "?stay", ben: "?stay" } }),

    // ── The venues, a page nobody wrote ──
    story("The couple add a venue, and it is in the list", { as: "couple", from: "venues?new", does: board("add", "/venues/-", { name: "Arnos Vale" }), seen: { couple: "venues" } }),
    story("The couple put a picture on a venue", { as: "couple", from: "venues?row=1", does: board("replace", "/venues/1/picture_key", "seed/mount-without.svg"), seen: { couple: "venues?row=1" } }),
    story("The couple cross a venue off, and it leaves the list", { as: "couple", from: "venues?confirm=2", does: board("remove", "/venues/2"), seen: { couple: "venues" } }),
  ],
};

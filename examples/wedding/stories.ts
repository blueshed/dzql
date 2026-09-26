// The wedding, told as stories: who does what, and who then sees it, where. See stories.md at the
// root. Ids are the seed's (seed.sql): the Okafors are household 1 with guests 1
// (Ada) and 2 (Femi), one plus-one still to name, and one open ask (1, Kemi); Ben is household 2
// with guest 3 and no plus-one; gifts are 1 (casserole), 2 (the honeymoon fund, shared) and 3
// (knives); course 2 is the main, with dish 5 (sea bass) and drink 3 (Rioja). Paths name rows by
// id, never by position.
//
// Where: the page's address -- the page, and after a `?` the one thing open over it -- and after
// " @ ", `reading.family-1=list` (how one of the couple's collections is read). A household's page
// is its photo: "" (the household, with a waiting ask as a ghost), "list" (the same people as a
// list) or "everyone" (the photo every household watches); over it, a guest's drawer (`?guest=2`),
// the answer's (`?answer`), the plus's modal (`?new=guests` names a plus-one, `?new=asks` asks the
// couple), and the information a household reads and puts away: `?gifts`, `?day`, `?stay`. The
// couple's are "" (the welcome and the counts), "households", "households/<id>" (a family's box),
// "courses", "gifts", "events" and "places", with `?keep=courses/1` (their drawer for a row).
import type { PatchOp } from "../../src/json-patch";
import { story, type Stories, type Write } from "../../src/stories";

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

/** Where someone must stand to see it, as one session write: the page's address -- the page, and
 * after a `?` the one thing open over it ("?gifts", "list?guest=2") -- and after " @ " how a
 * collection is read there (`reading.family-1=list`). */
function goTo(address: string): Write {
  const [page = "", rest] = address.split(" @ ");
  const ops: PatchOp[] = [{ op: "replace", path: "/page", value: page }];
  for (const pair of rest ? rest.split(", ") : []) {
    const [key, value] = pair.split("=") as [string, string];
    ops.push({ op: "replace", path: `/${key.split(".").join("/")}`, value });
  }
  return { doc: "session", ops };
}

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
    // ── The welcome, before a code ──
    story("A stranger types the couple's code and is on the board", { as: "stranger", does: session("/code", "DASH"), seen: ["stranger"] }),
    story("A stranger types a code nobody has, and is told it was not recognised", { as: "stranger", cannot: session("/code", "NOPE"), told: "That code was not recognised." }),
    story("A stranger asks for their code again, and the welcome says it is sent if known", { as: "stranger", does: session("/resend", "ada@example.com"), seen: ["stranger"] }),
    story("Without a code there is no page to go to", { as: "stranger", cannot: session("/page", "gifts") }),

    // ── Going somewhere, and leaving ──
    story("The Okafors open the gift list, and only their tab moves", { as: "okafors", does: session("/page", "?gifts"), seen: ["okafors"], untold: ["couple", "ben", "benToo", "stranger"] }),
    story("Leaving the site forgets the code", { as: "okafors", does: session("/code"), seen: ["okafors"] }),

    // ── A household answers ──
    story("The Okafors say maybe, and the couple's board and everyone's photo change", { as: "okafors", does: household("replace", "/answer", "maybe"), seen: { okafors: "?answer", couple: "households", benToo: "everyone" } }),
    story("The Okafors take their answer back", { as: "okafors", does: household("remove", "/answer"), seen: { okafors: "?answer", couple: "households", benToo: "everyone" } }),
    story("Femi is not coming after all, and the photo loses him", { as: "okafors", from: "?guest=2", does: household("replace", "/guests/2/coming", "0"), seen: { okafors: "", couple: "households", benToo: "everyone" } }),
    story("Femi's coming is left undecided, and the list shows it", { as: "okafors", from: "list?guest=2", does: household("remove", "/guests/2/coming"), seen: { okafors: "list", couple: "households/1/guests @ reading.family-1=list" } }),
    story("The Okafors leave the caterer a note, and only the couple read it", { as: "okafors", from: "?answer", does: household("replace", "/message", "Ada is vegetarian."), seen: { okafors: "", couple: "households/1" }, untold: ["ben", "benToo"] }),
    story("The Okafors take the note back, emptying it", { as: "okafors", from: "?answer", does: household("replace", "/message", ""), seen: { okafors: "", couple: "households/1" } }),

    // ── Guests, figures, choices ──
    story("The Okafors bring a plus-one, and the couple see the name", { as: "okafors", from: "?new=guests", does: household("add", "/guests/-", "Tolu Adebayo"), seen: { okafors: "", couple: "households/1", benToo: "everyone" } }),
    story("Femi's top turns green, and the photo everyone watches changes", { as: "okafors", from: "?guest=2", does: household("replace", "/guests/2/minifigure/top", "#7FAE4E"), seen: { okafors: "", couple: "households", benToo: "everyone" } }),
    story("Femi picks the sea bass, and the couple's list shows it", { as: "okafors", from: "list?guest=2", does: household("replace", "/guests/2/choices/2/dish", 5), seen: { okafors: "list", couple: "households/1/guests @ reading.family-1=list" } }),
    story("Femi picks the Rioja", { as: "okafors", from: "list?guest=2", does: household("replace", "/guests/2/choices/2/drink", 3), seen: { okafors: "list", couple: "households/1/guests @ reading.family-1=list" } }),
    story("Femi cannot change his mind about a wine he has not chosen", { as: "okafors", cannot: household("remove", "/guests/2/choices/2/drink") }),
    story("A household cannot uninvite one of its own guests; only Undo can", { as: "okafors", cannot: household("remove", "/guests/1") }),

    // ── Asks ──
    story("Ben, with no plus-one, asks to bring his sister, and she stands in his photo as a ghost until the couple answer", { as: "ben", from: "?new=asks", does: household("add", "/asks/-", "Lotte Achterberg"), seen: { ben: "", benToo: "", couple: "households/2" } }),
    story("The couple say yes to Kemi, and she is a guest in the Okafors' photo", { as: "couple", from: "households/1/asks", does: board("replace", "/households/1/asks/1/reply", "yes"), seen: { couple: "households/1", okafors: "", benToo: "everyone" } }),
    story("The couple say no to Kemi, and her ghost leaves the Okafors' photo", { as: "couple", from: "households/1/asks", does: board("replace", "/households/1/asks/1/reply", "no"), seen: { couple: "households/1", okafors: "" } }),
    story("The couple cannot withdraw a reply they have not given", { as: "couple", cannot: board("remove", "/households/1/asks/1/reply") }),

    // ── Gifts ──
    story("The Okafors claim the casserole, and it leaves Ben's list", { as: "okafors", from: "?gifts", does: household("add", "/claims/-", 1), seen: { okafors: "?gifts", couple: "gifts", ben: "?gifts" } }),
    story("The Okafors give to the honeymoon, and Ben still can", { as: "okafors", from: "?gifts", does: household("add", "/claims/-", 2), seen: { okafors: "?gifts", couple: "gifts", ben: "?gifts" } }),
    story("Ben claims the knives", { as: "ben", from: "?gifts", does: household("add", "/claims/-", 3), seen: { ben: "?gifts", benToo: "?gifts", couple: "gifts", okafors: "?gifts" } }),

    // ── The couple keep the wedding ──
    story("The couple change their message, and every welcome changes", { as: "couple", from: "?answer", does: board("replace", "/message", "See you in April."), seen: { couple: "?answer", stranger: "" } }),
    story("The couple set a deadline, and the households see it", { as: "couple", from: "?answer", does: board("replace", "/deadline", "2027-03-01"), seen: { couple: "", okafors: "", ben: "", benToo: "" } }),
    story("The couple invite the Londons", { as: "couple", from: "households?new=households", does: board("add", "/households/-", { email: "londons@example.com", plus_ones: 2 }), seen: { couple: "" } }),
    story("The couple correct Ben's email", { as: "couple", from: "households/2?keep=households/2", does: board("replace", "/households/2/email", "ben@achterberg.example"), seen: { couple: "households/2" } }),
    story("The couple let Ben bring one more, and he may name them himself", { as: "couple", from: "households/2?keep=households/2", does: board("replace", "/households/2/plus_ones", 1), seen: { couple: "households/2?keep=households/2", ben: "", benToo: "" } }),
    story("The couple add a guest to Ben's invitation", { as: "couple", from: "households/2/guests?new=guests", does: board("add", "/households/2/guests/-", "Mara Achterberg"), seen: { couple: "households/2", ben: "", benToo: "" } }),
    story("The couple take Ben off his own invitation", { as: "couple", from: "households/2/guests?confirm=guests/3", does: board("remove", "/households/2/guests/3"), seen: { couple: "households/2", ben: "", benToo: "" } }),

    // ── The lists ──
    story("The couple add a course, and a guest's drawer gains a stage of the meal", { as: "couple", from: "courses?new=courses", does: board("add", "/courses/-", "Cheese"), seen: { couple: "courses", okafors: "?guest=2", ben: "?guest=3" } }),
    story("The couple drop the toast", { as: "couple", from: "courses?confirm=courses/4", does: board("remove", "/courses/4"), seen: { couple: "courses", okafors: "?guest=2", ben: "?guest=3" } }),
    story("The couple rename the main", { as: "couple", from: "courses?keep=courses/2", does: board("replace", "/courses/2/name", "Mains"), seen: { couple: "courses?keep=courses/2", okafors: "?guest=2", ben: "?guest=3" } }),
    story("The couple offer a vegan main", { as: "couple", from: "courses?keep=courses/2", does: board("add", "/courses/2/dishes/-", { name: "Aubergine tagine", dietary: "vg, gf" }), seen: { couple: "courses?keep=courses/2", okafors: "?guest=2", ben: "?guest=3" } }),
    story("The couple take the beef off", { as: "couple", from: "courses?keep=courses/2", does: board("remove", "/courses/2/dishes/4"), seen: { couple: "courses?keep=courses/2", okafors: "?guest=2", ben: "?guest=3" } }),
    story("The couple mark the crab as gluten free", { as: "couple", from: "courses?keep=courses/1", does: board("replace", "/courses/1/dishes/3/dietary", "gf"), seen: { couple: "courses?keep=courses/1", okafors: "?guest=2", ben: "?guest=3" } }),
    story("The couple add a gift, and it is on every list", { as: "couple", from: "gifts?new=gifts", does: board("add", "/gifts/-", { name: "A tree for the garden", description: "A crab apple." }), seen: { couple: "gifts", okafors: "?gifts", ben: "?gifts" } }),
    story("The couple add an event to the day", { as: "couple", from: "events?new=events", does: board("add", "/events/-", { name: "Fireworks", when_at: "2027-04-02T22:00" }), seen: { couple: "events", okafors: "?day", ben: "?day" } }),
    story("The couple add somewhere to stay", { as: "couple", from: "places?new=places", does: board("add", "/places/-", { name: "The Bristol Hotel", notes: "Ask for the wedding rate." }), seen: { couple: "places", okafors: "?stay", ben: "?stay" } }),

    // ── Refusals ──
    story("A household cannot change the couple's welcome", { as: "ben", cannot: board("replace", "/message", "Hi") }),
    story("A household cannot invite anyone", { as: "ben", cannot: board("add", "/households/-", { email: "x@example.com" }) }),
    story("The couple cannot answer for a household", { as: "couple", cannot: household("replace", "/answer", "yes") }),
    story("A stranger cannot answer", { as: "stranger", cannot: household("replace", "/answer", "yes") }),
    story("A household cannot take another's claim; the casserole is the Okafors'", { as: "ben", cannot: household("remove", "/claims/1") }),
  ],
};

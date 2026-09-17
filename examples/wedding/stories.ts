// The wedding, told as stories: who does what, and who then sees it, where. See stories.md at the
// root. Ids are the seed's (migrations/0002_seed.sql): the Okafors are household 1 with guests 1
// (Ada) and 2 (Femi) and one open ask (1, Kemi); Ben is household 2 with guest 3; gifts are 1
// (casserole), 2 (the honeymoon fund, shared) and 3 (knives); course 2 is the main, with dish 5
// (sea bass) and drink 3 (Rioja). Paths name rows by id, never by position.
//
// Where: the page's address -- the page, and after a `?` the one thing open over it: `?guest=2`
// (a guest's drawer), `?keep=courses/1` (the couple's drawer for a row), `?gift=1`, `?answer` --
// and after " @ ",
// `reading.guests=list` (how a collection is read). A household's pages are "" (its box), "asks",
// "gifts", "day", "stay" and "everyone" (the photo); the couple's are "" (the welcome and the
// counts), "households", "households/<id>" (a family's box), "courses", "gifts", "events",
// "places" and "everyone".
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
 * after a `?` the one thing open over it ("gifts?gift=1", "?answer") -- and after " @ " how a
 * collection is read there (`reading.guests=list`). */
function at(where: string): Write {
  const [page = "", rest] = where.split(" @ ");
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
  at,
  stories: [
    // ── The welcome, before a code ──
    story("A stranger types the couple's code and is on the board", { as: "stranger", does: session("/code", "DASH"), seen: ["stranger"] }),
    story("A stranger types a code nobody has, and the welcome says so", { as: "stranger", does: session("/code", "NOPE"), seen: ["stranger"] }),
    story("A stranger asks for their code again, and the welcome says it is sent if known", { as: "stranger", does: session("/resend", "ada@example.com"), seen: ["stranger"] }),
    story("Without a code there is no page to go to", { as: "stranger", cannot: session("/page", "gifts") }),

    // ── Going somewhere, and leaving ──
    story("The Okafors open the gift list, and only their tab moves", { as: "okafors", does: session("/page", "gifts"), seen: ["okafors"], unseen: ["couple", "ben", "benToo", "stranger"] }),
    story("Leaving the site forgets the code", { as: "okafors", does: session("/code"), seen: ["okafors"] }),

    // ── A household answers ──
    story("The Okafors say maybe, and the couple's board and everyone's photo change", { as: "okafors", does: household("replace", "/answer", "maybe"), seen: { okafors: "?answer", couple: "households", benToo: "everyone" } }),
    story("The Okafors take their answer back", { as: "okafors", does: household("remove", "/answer"), seen: { okafors: "?answer", couple: "households", benToo: "everyone" } }),
    story("Femi is not coming after all, and the photo loses him", { as: "okafors", does: household("replace", "/guests/2/coming", "no"), seen: { okafors: "", couple: "households", benToo: "everyone" } }),
    story("Femi's coming is left undecided, and the list shows it", { as: "okafors", does: household("remove", "/guests/2/coming"), seen: { okafors: "guests @ reading.guests=list", couple: "households/1/guests @ reading.family-1=list" } }),
    story("The Okafors leave the caterer a note, and only the couple read it", { as: "okafors", does: household("replace", "/message", "Ada is vegetarian."), seen: { okafors: "", couple: "households/1" }, unseen: ["ben", "benToo"] }),
    story("The Okafors take the note back", { as: "okafors", does: household("remove", "/message"), seen: { okafors: "", couple: "households/1" } }),

    // ── Guests, figures, choices ──
    story("The Okafors bring a plus-one, and the couple see the name", { as: "okafors", does: household("add", "/guests/-", { name: "Tolu Adebayo" }), seen: { okafors: "", couple: "households/1", benToo: "everyone" } }),
    story("Femi's top turns green, and the photo everyone watches changes", { as: "okafors", does: household("replace", "/guests/2/minifigure/top", "#7FAE4E"), seen: { okafors: "", couple: "households", benToo: "everyone" } }),
    story("Femi picks the sea bass, and the couple's list shows it", { as: "okafors", does: household("replace", "/guests/2/choices/2/dish", 5), seen: { okafors: "guests @ reading.guests=list", couple: "households/1/guests @ reading.family-1=list" } }),
    story("Femi picks the Rioja", { as: "okafors", does: household("replace", "/guests/2/choices/2/drink", 3), seen: { okafors: "guests @ reading.guests=list", couple: "households/1/guests @ reading.family-1=list" } }),
    story("Femi cannot change his mind about a wine he has not chosen", { as: "okafors", cannot: household("remove", "/guests/2/choices/2/drink") }),
    story("A household cannot uninvite one of its own guests; only Undo can", { as: "okafors", cannot: household("remove", "/guests/1") }),

    // ── Asks ──
    story("The Okafors ask to bring Ada's mother, and the couple see the ask", { as: "okafors", does: household("add", "/asks/-", { name: "Ngozi Okafor" }), seen: { okafors: "asks", couple: "households/1" } }),
    story("The couple say yes to Kemi, and a guest appears in the Okafors' box", { as: "couple", does: board("replace", "/households/1/asks/1/reply", "yes"), seen: { couple: "households/1", okafors: "", benToo: "everyone" } }),
    story("The couple say no to Kemi", { as: "couple", does: board("replace", "/households/1/asks/1/reply", "no"), seen: { couple: "households/1", okafors: "asks" } }),
    story("The couple cannot withdraw a reply they have not given", { as: "couple", cannot: board("remove", "/households/1/asks/1/reply") }),

    // ── Gifts ──
    story("The Okafors claim the casserole, and it leaves Ben's list", { as: "okafors", does: household("add", "/claims/-", 1), seen: { okafors: "gifts?gift=1", couple: "gifts", ben: "gifts" } }),
    story("The Okafors give to the honeymoon, and Ben still can", { as: "okafors", does: household("add", "/claims/-", 2), seen: { okafors: "gifts?gift=2", couple: "gifts", ben: "gifts" } }),
    story("Ben claims the knives", { as: "ben", does: household("add", "/claims/-", 3), seen: { ben: "gifts?gift=3", benToo: "gifts", couple: "gifts", okafors: "gifts" } }),

    // ── The couple keep the wedding ──
    story("The couple change their message, and every welcome changes", { as: "couple", does: board("replace", "/message", "See you in April."), seen: { couple: "?answer", stranger: "" } }),
    story("The couple set a deadline, and the households see it", { as: "couple", does: board("replace", "/deadline", "2027-03-01"), seen: { couple: "", okafors: "", ben: "" } }),
    story("The couple invite the Londons", { as: "couple", does: board("add", "/households/-", { email: "londons@example.com", plus_ones: 2 }), seen: { couple: "" } }),
    story("The couple correct Ben's email", { as: "couple", does: board("replace", "/households/2/email", "ben@achterberg.example"), seen: { couple: "households/2" } }),
    story("The couple let Ben bring one more", { as: "couple", does: board("replace", "/households/2/plus_ones", 1), seen: { couple: "households/2?keep=households/2", ben: "guests" } }),
    story("The couple add a guest to Ben's invitation", { as: "couple", does: board("add", "/households/2/guests/-", "Mara Achterberg"), seen: { couple: "households/2", ben: "" } }),
    story("The couple take Ben off his own invitation", { as: "couple", does: board("remove", "/households/2/guests/3"), seen: { couple: "households/2", ben: "" } }),

    // ── The lists ──
    story("The couple add a course, and a guest's drawer gains a stage of the meal", { as: "couple", does: board("add", "/courses/-", "Cheese"), seen: { couple: "courses", okafors: "?guest=2", ben: "?guest=3" } }),
    story("The couple drop the toast", { as: "couple", does: board("remove", "/courses/4"), seen: { couple: "courses", okafors: "?guest=2", ben: "?guest=3" } }),
    story("The couple rename the main", { as: "couple", does: board("replace", "/courses/2/name", "Mains"), seen: { couple: "courses?keep=courses/2", okafors: "?guest=2", ben: "?guest=3" } }),
    story("The couple offer a vegan main", { as: "couple", does: board("add", "/courses/2/dishes/-", { name: "Aubergine tagine", dietary: "vg, gf" }), seen: { couple: "courses?keep=courses/2", okafors: "?guest=2", ben: "?guest=3" } }),
    story("The couple take the beef off", { as: "couple", does: board("remove", "/courses/2/dishes/4"), seen: { couple: "courses?keep=courses/2", okafors: "?guest=2", ben: "?guest=3" } }),
    story("The couple mark the crab as gluten free", { as: "couple", does: board("replace", "/courses/1/dishes/3/dietary", "gf"), seen: { couple: "courses?keep=courses/1", okafors: "?guest=2", ben: "?guest=3" } }),
    story("The couple add a gift, and it is on every list", { as: "couple", does: board("add", "/gifts/-", { name: "A tree for the garden", description: "A crab apple." }), seen: { couple: "gifts", okafors: "gifts", ben: "gifts" } }),
    story("The couple add an event to the day", { as: "couple", does: board("add", "/events/-", { name: "Fireworks", when_at: "2027-04-02T22:00" }), seen: { couple: "events", okafors: "day" } }),
    story("The couple add somewhere to stay", { as: "couple", does: board("add", "/places/-", { name: "The Bristol Hotel", notes: "Ask for the wedding rate." }), seen: { couple: "places", okafors: "stay" } }),

    // ── Refusals ──
    story("A household cannot change the couple's welcome", { as: "ben", cannot: board("replace", "/message", "Hi") }),
    story("A household cannot invite anyone", { as: "ben", cannot: board("add", "/households/-", { email: "x@example.com" }) }),
    story("The couple cannot answer for a household", { as: "couple", cannot: household("replace", "/answer", "yes") }),
    story("A stranger cannot answer", { as: "stranger", cannot: household("replace", "/answer", "yes") }),
    story("A household cannot take another's claim; the casserole is the Okafors'", { as: "ben", cannot: household("remove", "/claims/1") }),
  ],
};

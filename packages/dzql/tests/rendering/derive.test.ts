import { describe, expect, test } from "bun:test";
import { defineSchema } from "@blueshed/delta/sqlite";
import { bento } from "../../src/rendering/bento";
import { derivedPage, type Derivation } from "../../src/rendering/derive";
import { write } from "../../src/rendering/html";

// A page drawn from a collection's shape: delta's columns, a declaration beside them, and the
// permit, asked. The bento's own surfaces draw it; these say which, and with what.

const icon = (name: string): string => `<i data-icon="${name}"></i>`;
const b = bento({ icon, session: "desk" });
const schema = defineSchema({
  venues: { columns: { name: "text", seats: "integer", notes: "text?", picture_key: "text?", kind: { type: "text", default: "barn" }, extra: "json?" } },
});
const rows = [
  { id: 1, name: "The Mount", seats: 120, notes: "<booked>", picture_key: null, kind: "church", extra: {} },
  { id: 2, name: "The Barn", seats: 80, notes: null, picture_key: "barn.svg", kind: "barn", extra: null },
];
const go = (page: string): string => write("desk", "replace", "/page", page);

const derive = (page: string, o: Partial<Derivation> = {}) =>
  derivedPage(b, {
    doc: "board",
    table: schema.tables.venues!,
    declared: { noun: "venue", fields: { picture_key: { label: "Picture", applet: "picture-field" } } },
    rows,
    page,
    trail: [{ label: "Us", back: go("") }],
    may: () => true,
    ...o,
  });

describe("a page drawn from a collection's shape", () => {
  test("its page: the trail and the collection's name, a row each named by its first column and opening its drawer, and the plus where the permit lets a row be added", () => {
    const { page, drawer, modal } = derive("venues");
    expect(page).toContain(`<span>Us</span></a><span class="chev"><i data-icon="chevron-right"></i></span><span class="cell-name">Venues</span>`);
    expect(page).toContain(`id="venues-1"`);
    expect(page).toContain(go("venues?row=2"));
    expect(page).toContain(`<span class="what">The Barn</span>`);
    expect(page).toContain(`aria-label="New venue"${go("venues?new")}`);
    expect([drawer, modal]).toEqual(["", ""]);
    const none = derive("venues", { rows: [], may: () => false }).page;
    expect(none).toContain("No venues yet.");
    expect(none).not.toContain("New venue");
  });

  test("a row's drawer: each field typed by its column and named by it or by the declaration, read where the permit says no, its applet where one is declared; json is not drawn; Remove where the permit lets it", () => {
    const may = (op: string, path: string) => path !== "/venues/1/notes" && op !== "remove";
    const { drawer, page } = derive("venues?row=1", { may });
    expect(page).toContain(`id="venues-1" ${go("venues?row=1").trim()} aria-expanded="true" data-reveal`);
    expect(drawer).toContain(`aria-label="The Mount"`);
    // each the bento's field: a form of its own, its label tied to it
    expect(drawer).toContain(`<form data-eta-part="venues-1-seats" class="prop" data-write-on="blur"><label class="prop-name cap" for="field-board-venues-1-seats">Seats</label>`);
    expect(drawer).toContain(`id="field-board-venues-1-seats" name="seats"${write("board", "replace", "/venues/1/seats")} type="number" step="any" value="120"`);
    expect(drawer).toContain(`name="name"${write("board", "replace", "/venues/1/name")} type="text"`);
    expect(drawer).toContain(`<div class="prop-value">&lt;booked&gt;</div>`); // the permit says no: read, not typed
    expect(drawer).toContain(`<span class="prop-name cap">Picture</span>`);
    expect(drawer).toContain(`<div data-applet="picture-field" data-writes='[{"doc":"board","op":"replace","path":"/venues/1/picture_key"}]' data-props="{&quot;doc&quot;:&quot;board&quot;,&quot;path&quot;:&quot;/venues/1/picture_key&quot;,&quot;current&quot;:null}"></div>`);
    expect(drawer).not.toContain("Extra");
    expect(drawer).not.toContain("Remove this venue");
    expect(derive("venues?row=1").drawer).toContain(`Remove this venue</button>`);
    expect(derive("venues?row=1").drawer).toContain(go("venues?confirm=1"));
    expect(derive("venues?row=9").drawer).toBe("");
  });

  test("its modals: a new one asks only for what cannot be empty, typed by its column; a removal asks first, and its cancel goes back to the row", () => {
    const added = derive("venues?new").modal;
    expect(added).toContain(`<h3>New venue</h3><form${write("board", "add", "/venues/-")}>`);
    expect([...added.matchAll(/<input name="(\w+)" type="(\w+)"/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual(["name text", "seats number"]);
    expect(derive("venues?new", { may: (op) => op !== "add" }).modal).toBe("");

    const removed = derive("venues?confirm=2").modal;
    expect(removed).toContain(`<h3>The Barn</h3><p class="note">Take it off the venues?</p>`);
    expect(removed).toContain(write("board", "remove", "/venues/2"));
    expect(removed).toContain(go("venues?row=2"));
    expect(derive("venues?confirm=2", { may: (op) => op !== "remove" }).modal).toBe("");
    expect(derive("venues?confirm=9").modal).toBe("");
  });
});

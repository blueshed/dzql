# A page drawn from a document's shape (`src/rendering/derive.ts`)

For a collection nobody would write a page for (reference data: the wedding's venues), draw it from
what it declares, at render time, never generated, from [bento.md](bento.md)'s parts.

```ts
// examples/wedding/delta.ts: beside the schema, what the columns cannot say
export const derived: Record<string, Declared> = {
  venues: { noun: "venue", fields: { picture_key: { label: "Picture", applet: "picture-field" } } },
};

// examples/wedding/views/board.ts
const d = derivedPage(surfaces, { doc: "board", table: schema.tables[table]!, declared: derived[table]!, rows: v.b.derived[table]!, page, trail: [{ label: coupleName(v.b), back: nav("") }], may: v.may });
return frame(false, layers(d.page, d.drawer, d.modal), page);
```

It gives a collection of rows, a drawer that changes one (`?row=<id>`), and the modals that add one
(`?new`) and take one off (`?confirm=<id>`). `rows` are the document's, as the page read them; `may(op,
path)` is the compartment's permit ([compartment.md](compartment.md)), asked for each control.

The ladder, and where it stops:

1. **Derived.** A field is typed by its column (a number for an integer or a real, else text; json is
   not drawn) and named by it, drawn by `field()` ([controls.md](controls.md)). A field the permit
   refuses is read, not typed. The add modal asks for what cannot be empty; a row is named by its first column.
2. **A field names an applet.** It is drawn as that applet's mount, given `{ doc, path, current }`,
   declaring the one write it sends. Register another applet under that name (`registerApplet`,
   last wins) and the field changes on every derived page.
3. **The page by hand**, from the same parts. Nothing in between: no templates, no settings.

The app still routes its address to it (one line in its render), puts a control that leads there,
and lets its `shape` take the writes (the wedding's board takes the columns from the schema, as text).

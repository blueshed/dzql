# A page drawn from a document's shape (`src/derive.ts`)

A collection page drawn from what a document declares, for data nobody would write a page for, from [bento.md](bento.md)'s parts.

For a collection nobody would write a page for (reference data: the wedding's venues), draw it
from what it declares, at render time, never generated: `derivedPage(surfaces, { doc, table,
declared, rows, page, trail, may })` gives a collection page of rows, a drawer that changes one
(`?row=<id>`), and the modals that add one (`?new`) and take one off (`?confirm=<id>`), from the
bento's own parts. `table` is delta's (`schema.tables.venues`); `rows` the document's, as the page
read them; `may(op, path)` the compartment's permit ([compartment.md](compartment.md)), asked for each control, so what may be written
is said once (the wedding's board passes the rule its `permit` uses). The app declares the rest
beside its schema (the wedding's `derived` in `delta.ts`): a noun, and a field's label or applet.

```ts
export const derived: Record<string, Declared> = {
  venues: { noun: "venue", fields: { picture_key: { label: "Picture", applet: "picture-field" } } },
};
```

The ladder, and where it stops:

1. **Derived.** A field is typed by its column (a number for an integer or a real, else text; json
   is not drawn) and named by it. A field the permit refuses is read, not typed. The add modal asks
   for what cannot be empty; a row is named by its first column.
2. **A field names an applet.** It is drawn as that applet's mount, given `{ doc, path, current }`
   and declaring the one write it sends. Register another applet under that name
   (`registerApplet`, last wins) and the field changes on every derived page: an override is a
   registration, not an edit to every view.
3. **The page by hand.** Past that, the app draws the page itself from the same parts, as the
   wedding's other lists are. Nothing in between: no templates by mode, no blocks, no settings.

The app still routes its address to it (one line in its render), puts a control that leads there,
and lets its `shape` take the writes: the wedding's board takes a derived collection's columns from
the schema, as text.

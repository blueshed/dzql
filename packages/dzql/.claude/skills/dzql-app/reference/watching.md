# An applet's data: the document it watches

An applet's data comes from a document it watches, patched as delta tells it; its props say only
what to show, and for whom. The applet itself is [applets.md](applets.md).

```ts
// examples/wedding/views/household.ts: the photo of everyone watches the `everyone` document
function everyonePhoto(props: CrowdProps): string {
  const doc = watch(`everyone:${weddingDoc.WEDDING}`, "/everyone");
  return part("everyone-photo", `<div id="everyone-photo" data-applet="crowd"${appletProps(props, doc)}${tapsOf(crowd(props).photo.entries)}></div>`);
}
// gives data-doc="everyone:1" data-under="/everyone" data-v="7" data-props="{…}"
```

`watch(doc, under)` (`src/rendering/documents.ts`) reads the document for the page and says the version held;
`appletProps(props, watch?)` (`src/rendering/html.ts`) is the one helper that quotes props into an attribute.

- The props hold the document whole at `under` (the root when not given), rows by id as delta holds
  them. The rest is small: who is looking, what is open.
- The client lays each patch on the props and calls `update(el, props)`: draw from props, whether they
  came with a render or a patch. An applet with `patch` gets the ops instead.
- A patch at or below `data-v` is passed over; an op that does not land is drift, and the page is
  asked for afresh.
- Derive what is drawn with a pure function both import: the applet in the browser, the server for
  the first paint, `appletWrites` and what the page says around it.
- A change to the document sends the mount nothing but the patch. The mount goes again only when its
  own tag changes, so keep what follows a person (`aria-expanded`, a class) beside the mount.
- The stories check that each member's props, as sent with every patch since, equal a fresh render.
- A watched document is sent whole, with the mount and in every patch: watch one cut for the page's
  audience, holding no secret (the wedding's `everyone`, never the board with every code).
- Each watching mount carries its own copy, paid once as it opens.
- Without `data-doc`, a mount is re-sent its props whenever they change: keep that for small props.

## Cut the document to what the applet shows

- The ticker's board is a row applet per symbol, each on its own document (`quote:<SYMBOL>`), so a
  board is told only the quotes it shows.
- From one big document, cut a second over the same rows in `delta.ts` ([documents.md](documents.md)),
  with a resource of its own that permits nothing. A `defineCustomDoc` recompute holds only what
  it selects but is told whole (`replace ""`) on every write to what it watches: keep it small. A
  plain `defineDoc` over just the collections is told field by field; `columns` narrows it.
  `tests/rendering/documents.test.ts` holds both.

## When props cost

`bun run stories` warns (`propsCost`, `src/modelling/harness.ts`), once each:

- a mount whose props, its document left out, pass 4 KB (`MOST_PROPS`): watch the document they
  come from;
- a mount sent again with props the page already had: move what changed beside the mount, let it
  watch its document, or make what changed a part of its own (the wedding's `everyone-note`).

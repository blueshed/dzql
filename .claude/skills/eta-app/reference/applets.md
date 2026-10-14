# Applets (`src/applets.ts`)

An applet is client code that draws inside one element, only for a piece of the page whose browser
state a redraw would destroy: a drag halfway through, a scroll position, a chart's history.
Everything else is HTML from `render`. Its data, when it watches a document, is [watching.md](watching.md).

```ts
// examples/leave/page.ts: the mount, drawn by the server first, saying what it writes
part("calendar", `<div id="calendar" class="calendar-view" data-applet="calendar"${appletWrites(["session", "replace", "/draft"], ["team", "replace", "/requests/*/starts"], ["team", "replace", "/requests/*/ends"])} data-props="${esc(JSON.stringify(p))}">${calendarHtml(p)}</div>`);

// examples/leave/applets/calendar-applet.ts: the drags; the drawing is ../calendar.ts, shared with the server
registerApplet("calendar", {
  mount(el, ctx) {
    state.set(el, { props: ctx.props as CalendarProps, preview: null, moved: false });
    draw(el);
    el.addEventListener("pointerdown", (e) => { … }); // let go: ctx.send("session", [{ op: "replace", path: "/draft", value }])
    …
  },
});

// examples/leave/client/main.ts: applets first, then the kernel's client
import "../applets/calendar-applet";
import "../../../src/client/app";
```

The contract is `Applet` in `src/applets.ts`; `appletWrites` and `appletProps` are `src/html.ts`.

- An applet is not "the view for X": plain `data-write` HTML is the default.
- Register it in `client/main.ts` before importing `src/client/app`. `client/index.html` has an
  element with `id="app"`.
- Neither the morph nor a render in parts goes inside `[data-applet]`: the mount itself may be a
  part (its tag, its props), nothing inside it.
- Split the drawing (`applets/<name>.ts` or the app's own module: pure, tested directly, run by the
  server for a first paint and for what the mount declares) from the mounting (`<name>-applet.ts`,
  the DOM, imported only by `client/main.ts`).

## Its controls

The stories cannot see controls drawn in the browser, so the mount says what they write:
`appletWrites([doc, op, path, value?], …)`.

- A path segment that is only `*` is any one member (an id from its props), never `-`: an applet that
  appends names the `-` itself (`["trip", "add", "/events/*/party/-"]`).
- Reading a document is not writing it: an applet that names nothing offers nothing, and its story
  fails until the mount says what it sends.
- Name only what it sends now: a write beside what it names is not the applet's, and one that can
  send nothing now (answers closed) names nothing.
- A write with only a few values names them, one each: that is how a tap says where it goes (the
  wedding's photo: `["session", "replace", "/page", "?guest=2"]`). Say each write once.
- `[doc, path]` (the old shape) fails every story that meets it.
- It sends with `ctx.send(doc, ops)`. A story works it with `gesture` ([stories.md](stories.md)); a
  drag by hand is pointer events, so wrap `setPointerCapture` in a `try`.

## Islands

An island is an applet written as a railroad component: `island(render, reduce?)` (`src/island.ts`).

```tsx
// examples/ticker/applets/city-picker-applet.tsx
const picker = island<ClockProps>((props, ctx, el) => {
  const zones = zonesFrom(el); // what the server drew inside el, as <option>s
  …
});
registerApplet("city-picker", picker);
```

- `render(props, ctx, el)` gets its props as a signal and returns what replaces `el`'s inside.
- It never binds `el`'s own attributes: they are the page's.
- Write one where an applet builds DOM by hand; keep a pure HTML-drawing function where there is
  one (the wedding's menu). A page with an island carries railroad; its file is `<name>-applet.tsx`.

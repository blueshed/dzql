# Is our CSS good, and accessible?

*25 September 2026.*

eta's look is two layers: the kernel's stylesheet (`eta/src/bento.css`), which draws the bento's
parts, and each example's own stylesheet, which imports it and sets the colours. This note asks
whether that CSS uses what the language now offers, and whether it serves everyone who reads the
page, by comparing it with the four projects before it: paintbrush, simple, zeta and duckdown.

We do not want Tailwind. It exists so that people need not name things or remember a stylesheet;
Claude has no trouble with either. The part of Tailwind worth having -- a small, fixed set of
values everything is drawn from -- we already have as tokens. What we need is to know that what we
carry forward is good and accessible.

**In short:** eta's CSS is the most accessible of the five and zeta's the most modern. None uses
cascade layers, container queries, `light-dark()`, logical properties or forced-colours support.
eta has a handful of real accessibility holes, all small, all in `bento.css`. They are filed as
eta todo #40-54.

## Where it stands (25 September 2026, eta 0.49.0)

**Done** (eta todos #40-44, #47), in `src/bento.css` and each example's tokens:
- one focus ring for every control, drawn outside it (inside a stack, which clips);
- the find bar shows focus while its field has it;
- what is chosen or pressed is outlined in forced colours;
- no animation under reduced motion, the window opening and the rails included;
- `.sr-only` uses `clip-path`;
- every example's `--edge` is at least 3:1 against its card.

**Open**, as eta todos:
- #45 "Reconnecting" is drawn by CSS, and others' changes arrive unannounced;
- #46 text is sized in px;
- #48 the find bar's buttons are 26px;
- #49 no cascade layers;
- #50 dark mode written twice, and `--ink-rgb`;
- #51 physical sides, not logical;
- #52 compartments answer the window, not their cell;
- #53 the small modern wins;
- #54 nothing tests the examples' contrast.

The baseline under "What to take forward" is the standard the open ones are held to.

## Words used

- **Token** -- a named value (`--accent`, `--space-md`) that the rules read instead of a literal.
  An example restyles eta by setting tokens, not by overriding rules.
- **Focus ring** -- the outline that shows which control the keyboard is on. Without one, a
  keyboard user is lost.
- **Forced colours** -- Windows High Contrast and similar: the system replaces the page's colours
  with the user's own and removes shadows and background images.
- **Reduced motion** -- a system setting asking pages not to animate; some people are made ill by
  motion.
- **Contrast ratio** -- how far apart two colours are in lightness, from 1:1 (the same) to 21:1
  (black on white). WCAG asks 4.5:1 for text and 3:1 for the edge of a control.
- **rem** -- a size relative to the reader's chosen font size. **px** ignores that choice.

## The five, side by side

What was counted: each project's stylesheets, by a script (`css-census.py` in the session
scratchpad).

| | paintbrush | simple | zeta | duckdown | eta |
|---|---|---|---|---|---|
| Lines of CSS | 268 | 426 | 1,481 | 1,705 | 1,119 |
| Tokens defined | 17 | 80 | 109 | 56 | 115 |
| Dark mode | no | no | yes | yes | chat only (ticker is always dark) |
| Focus ring rule | none | removes it | one rule for all | one rule for all | per part |
| Reduced motion | no | no | yes | no | yes, mostly |
| Sizes in rem : px | 65 : 36 | 32 : 19 | 500 : 189 | 122 : 208 | 26 : 444 |
| `color-mix` / `oklch` | no | no | yes | a little | no |
| Grid | no | no | a little | a little | yes |
| Layers, container queries, logical sides, forced colours | none | none | none | none | none |

**What each got right, to keep:**

- **paintbrush** -- a section of the stylesheet just for touch-target sizes.
- **simple** -- the type scale as tokens, in rem (`--font-size-sm`, `-base`, `-lg`).
- **zeta** -- one focus rule for every control (`:is(input, button, …):focus-visible`);
  `color-scheme: light dark`; reduced motion honoured; rem throughout; colours mixed with
  `color-mix()` rather than written out.
- **duckdown** -- the clearest statement of how tokens should work: a theme "sets a few of them
  rather than restyling elements". A global `:focus-visible` with a 2px offset. Headings that
  scale with the window (`clamp()`). Fields never below 16px, with the reason written beside it
  (iOS zooms the page otherwise). A line length of 46rem, about 75 characters.
- **eta** -- the page behind a modal is `inert`, so nothing behind it can be reached by keyboard
  either; an `sr-only` class for words only a screen reader needs; focus rings on compartments and
  rows; the drawer and modal skip their animation under reduced motion; 16px fields; a `--touch`
  token for control height. Text contrast passes in every example (checked below).

## Accessibility: where eta falls short

These matter first, because a person hits them.

| # | What | Why it matters |
|---|---|---|
| 40 | The find field removes its focus ring and puts nothing in its place | A keyboard user cannot see they are typing in it |
| 41 | Buttons have no focus rule; the trail shows focus only as an underline | The browser's default ring can vanish on a pressed (accent) button |
| 42 | A chosen compartment or row is marked only by shadow and background | Forced colours removes both: the selection disappears |
| 43 | Opening a compartment animates (260ms) under reduced motion; so do the rails | The drawer and modal already stop; these were missed |
| 44 | Field and control borders are about 1.7:1 | WCAG 1.4.11 asks 3:1 for the edge of a control |
| 45 | "Reconnecting…" is drawn by CSS, and others' changes arrive silently | Screen readers do not reliably read CSS-generated text |
| 46 | Text is sized in px; 13 rules set 11-12px text | The reader's own font-size setting is ignored |
| 47 | `.sr-only` uses the deprecated `clip` | Works today; `clip-path: inset(50%)` is the current form |
| 48 | The find bar's buttons are 26px | Passes WCAG's 24px minimum, below eta's own 40px `--touch` |

#45 is partly a question, not a fix: when someone else's change lands on your page, what, if
anything, should a screen reader hear? That is a page rule to decide, not a stylesheet bug.

**Contrast checked** (WCAG ratio, text on its background):

| Pair | chat | chat dark | ticker | wedding | bento |
|---|---|---|---|---|---|
| muted on card | 5.35 | 6.94 | 4.92 | 5.01 | 5.28 |
| accent on card | 5.12 | | 9.62 | | 5.74 |

All pass 4.5:1. Nothing keeps them passing (#54).

## Modern CSS: where eta could be simpler

None of these is a bug. Each removes something that is there only because the language used to
lack it.

| # | Feature | What it replaces in eta |
|---|---|---|
| 49 | **Cascade layers** (`@layer kernel, example;`) | Examples overriding the kernel by out-specifying it, and the `!important`s that fight over reduced motion |
| 50 | **`light-dark()`** with **`color-mix()`** | Every colour written twice, once in a dark-mode block; `--ink-rgb`, a token that exists only to make translucent shadows, which chat's dark theme bends to `0,0,0`; `--card-hover` |
| 51 | **Logical properties** (`inset-inline-end`, `padding-inline-start`) | `right`, `left` and friends; right-to-left then needs only a `dir` attribute |
| 52 | **Container queries** | A compartment's contents answer the window's width though the compartment may be a third of it; the 820px breakpoint written eight times |
| 46 | **A rem type scale** | px sizes (above) |
| 53 | **Small ones** | `text-wrap: balance` for headings; `accent-color` for checkboxes; `scrollbar-gutter: stable` so the page does not jump when a drawer locks scrolling; `:user-invalid`, which shows a required field refused before the save -- proof rule P4 done by the browser |

Container queries are the one that fits eta's idea most closely: the bento is a box of
compartments, and each compartment should be drawn for the space it has, not for the screen.

## What to take forward

A baseline for `bento.css`, and for anything after eta:

1. **Tokens are the whole interface.** An example sets tokens; it does not restyle kernel parts
   (duckdown's rule). The header of `bento.css` lists them, as it does now.
2. **One focus rule** for every control, `:focus-visible`, never removed without a replacement
   (`:focus-within` on the wrapper when the field itself is bare).
3. **Every state has a cue that survives forced colours**: an outline or border, not only a
   shadow or background.
4. **All motion stops under reduced motion**, view transitions included.
5. **Contrast by rule**: text 4.5:1, control edges 3:1, in light and dark, checked by a test.
6. **rem for type, 16px floor for fields**, a type scale as tokens.
7. **Layers** so order, not specificity, decides; **`light-dark()`** so each colour is written
   once; **`color-mix()`** so shades are derived, not listed.
8. **Logical sides and container queries** when the bento's rules are next revised.

Suggested order: #40-44 and #47 first (one short pass over `bento.css`, and the examples'
`--edge`), then #45 with the page rules, then #49-50 together, then the rest.

## Sources

- paintbrush: `blueshed/archive/paintbrush/styles.css`
- simple: `blueshed/archive/simple-2026/styles.css`, `preview/preview.css`
- zeta: `blueshed/zeta/examples/{products,calendar,projects,location,todo}/index.css`
- duckdown: `blueshed/duckdown/server/base/site.css`, `server/edit/styles.css`,
  `tests/example/static/theme.css`
- eta: `eta/src/bento.css`, `eta/examples/{chat,ticker,wedding}/client/styles.css`,
  `eta/examples/bento/styles.css`
- The todos: `eta/todo.jsonl`, #40-54.

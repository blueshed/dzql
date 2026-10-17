# Stories as code: one format that grows with the app

*A proposal, 17 October 2026, for Peter to decide. Nothing here is built.*

## The problem

An app is a set of stories: sentences someone using it could call true or false. Two of our
starting points keep them differently.

- **eta's apps** (now `dzql/modelling` and `dzql/rendering`) keep them as code. An app's
  `stories.ts` is a list of `story(name, body)`: the sentence, then who does what and who then
  sees it, in the wire's own words. The harness (`dzql/modelling`'s `run`) tells each one against
  the running app, so a story cannot exist without being checked.
- **paintbrush apps** keep them as prose, in `stories.md`, and CLAUDE.md asks for a test named for
  each. Nothing loads the file, so the link is a habit. In the Shed's second run, 23 of its 31
  stories had no test with that exact sentence: some near-misses, some never named, some renamed
  as the app grew. The stories were the spec, and nothing held the tests to them.

## The proposal

One format, `story(name, body?)`, that an app grows into as it grows.

1. **A story starts as a sentence in `stories.ts`**: `story("Sam adds a border spade to the
   shed's list, and Ann, who has the list open, sees it there without doing anything.")`, with no
   body. It is told by a test: the test takes its name from the story
   (`test(shed.addsTool.name, ...)`), so renaming or removing a story breaks the type check, and
   one test fails any story no test tells. That is paintbrush's step: the app's own tests drive
   its railroad pages, and the stories are what they are named for.
2. **It gains a body when the harness can tell it**: `as`, `does`, `seen`, `untold`, `cannot`,
   exactly as eta's stories have them. That is the step to `dzql/rendering`, where pages are drawn
   by the server and the harness can find the control, send the write and look at every page. A
   story with a body is told by the harness; one without is told by a test. One file holds both.
3. **The sentence never changes shape**: the same words read aloud to the person who asked, at
   every step. What grows is what checks it.

## Where the code lives

The open choice, for Peter:

- **(a) dependency-free in the template.** paintbrush's `stories.ts` defines a three-line `story`
  of the same shape, and a test helper (`toldByTests(stories)`). Moving to dzql/rendering swaps
  the import for `dzql/modelling`'s. No new dependency for a light app.
- **(b) `dzql/modelling` from the start.** `story`'s body becomes optional there, and the check
  that every story is told is its own. One definition, but a paintbrush app on a JSON file would
  take dzql as a dependency (today that brings `pg`, PGlite and `jose` with it).

I'd take (a) now: a light app stays light, the shapes match, and (b) is a one-line import change
when the app takes the step. If `dzql/modelling` is ever split from dzql's Postgres dependencies,
(b) costs nothing and becomes the answer.

## What changes

- **paintbrush**: `stories.md` becomes `stories.ts`; the template's message tests take their names
  from it; a test fails an untold story; CLAUDE.md's rule and the evolve skill's order of work say
  so ("write the story into `stories.ts`, then a test named from it"). A reference for the step to
  `dzql/rendering` shows a story gaining its body.
- **dzql/modelling**: `story(name, body?)`, a story with no body accepted by the format and passed
  over by the harness (it is a test's to tell), for apps that carry both kinds.
- **create-dzql**: the same `stories.ts`, as a paintbrush app on dzql.
- **The Shed**: `stories.md` and `expected.md` say `stories.ts`. Run 3 is measured on it: does
  each stage write its stories as code its tests cannot drift from, and does stage 5 (dzql) take
  the step to bodies?

## Questions

1. (a) or (b) for where `story` lives?
2. Does paintbrush come into this repo, beside create-dzql? Its template and create-dzql's would
   then share one `stories.ts` and one evolve skill.
3. Should a story without a body ever be allowed in an app on `dzql/rendering`, or must every
   story there be told by the harness?

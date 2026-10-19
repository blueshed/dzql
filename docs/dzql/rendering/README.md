# Docs

**Guidance**: what dzql's rendering (once called eta) is for and how to build on it. Where these and the code disagree, the code,
`packages/dzql/CLAUDE.md` and the dzql-app skill are right; say so and fix the doc.

- The vision is the root README's *How an app is made*; `../modelling/stories.md` -- what the
  stories are for, and how they drive an app.
- `eta.md` -- what it is, its examples and commands, and what a write costs, measured by `bun run costs`.
- `bento/` -- where am I and what can I do: the directions (`README.md`), built in `src/rendering/bento.ts`,
  and two sets of sample designs (`design/`, `paintbrush/`).
- `first-app.md` -- a first app, step by step: chat, then leave, in the order you meet the words.
- `least-resistance.md` -- why it suits an AI that builds apps, and what would make it the easy path.
- `dzql-app-notes.md` -- the why behind the dzql-app skill: the numbers and the reasons that would weigh
  the skill down.

**The record**: what the kernel was asked for and how it was reviewed, all done; kept because code
comments and the changelogs cite it.

- `change-request.md` -- what the wedding asked of the kernel, eleven items, all done. A comment
  that says "item N" means these.
- `bento-request.md` -- the bento's rules built into the examples: kernel items K1-K3, then the
  wedding (W), chat (C) and the ticker (T), all done. A comment that says "K1" or "W3" means these.
- `eta-language.md` -- eta's words made easier to grasp, all applied.
- `css-review.md` -- is the CSS good and accessible: the review of 25 September.

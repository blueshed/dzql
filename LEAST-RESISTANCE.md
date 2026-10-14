# The Line of Least Resistance for AI

Why eta is built this way, why the modern stack works against AI, and what eta can do next to become the natural path of least resistance for building live applications.

---

## 1. The Realtime Truth: Single-User is a Myth

The web spent fifteen years pretending applications are "single-user by default" and that realtime collaboration is an exotic luxury feature bolted on for Google Docs or Figma.

In reality, almost no modern use is single-screen:
- A person adds a note on their phone while walking to their desk.
- They open their laptop and expect the note to be there without refreshing.
- They have two browser tabs open side-by-side, or an iPad on a stand.
- They approve a login or toggle a setting on their phone while their desktop waits.

In traditional SPA architectures (Next.js, React, REST, Supabase, Redux, TanStack Query), making "one user across three screens" work reliably is an architectural nightmare:
- Browser tabs cache stale state in memory.
- Writes on one screen silently overwrite writes on another or fail with optimistic lock conflicts.
- Developers (and AI agents) are forced to build an entire seven-layer synchronization stack: database migrations, REST route validation, WebSocket room brokers, client state caches, cache invalidation keys, and optimistic UI rollbacks.

**In eta, realtime is not a feature; it is the physics of the environment.**
- The kernel tracks what each screen is currently looking at (`src/reading.ts`).
- When Peter makes a change on his phone, the patch commits to `@blueshed/delta`.
- Eta immediately redraws and sends morph diffs to Peter's phone, Peter's laptop, and Peter's iPad.
- **The builder writes zero synchronization code.** Multi-device realtime comes for free by virtue of rendering HTML over live documents.

---

## 2. The AI Tax: Why the Modern Stack Fails Coding Agents

When an AI writes a modern React/Next.js/Tailwind application, it spends 80% of its token budget and reasoning capacity on accidental complexity:

1. **The Layer Tax**: A single feature requires coordinating across 5 to 7 files (ORM schema, API route, Zod validator, React component, state hook, cache invalidator). Every layer is an opportunity for hallucination, type drift, and subtle race conditions.
2. **The Tailwind Tax**: Utility class soup (`flex flex-col items-center justify-between p-4 bg-slate-50...`) dilutes the LLM's attention budget across presentation trivia rather than domain logic, inflates token counts 4x, produces noisy git diffs, and creates inconsistent styling across turns.
3. **The Verification Void**: An AI cannot easily prove a real-time, multi-device React feature works. End-to-end tests (Playwright/Cypress) are slow, flaky, and require managing multiple browser profiles. The AI writes code blindly and hopes the user tests it.

---

## 3. Why eta is Closer to the Line of Least Resistance

eta collapses the stack down to its essential geometry:
$$\text{Intent (Stories)} \longrightarrow \text{Shared Documents (Delta)} \longrightarrow \text{Server Views (Bento)}$$

- **Stories first**: `stories.ts` is the specification and the test. Sentences a customer could call true or false (*"Ada asks for three days off, and Mo sees it waiting"*) are tested over real sockets.
- **Sub-second deterministic verification**: `bun run stories` checks real sockets, permissions, and multi-user DOM morphs in milliseconds. If an AI makes a mistake, the harness fails immediately with exact precision.
- **Multi-user, per-device undo**: Undo walks back the session's own last write via Delta's inverse patches, even while other people (or Peter's other devices) keep writing.
- **Semantic CSS (`src/bento.css`)**: High-level semantic layout tokens (`.tray`, `.cell`, `.row`, `--ink`, `--accent`) keep HTML templates tiny, accessible, and clean.

---

## 4. The Remaining Resistance: What Still Slows Down AI

Despite this simplicity, an AI building in eta today still encounters friction:

1. **Training Data Prior Bias**: LLMs have ingested millions of React/Next.js repositories. When prompted naively, their statistical reflex is to reach for client-side state and REST APIs. They must be guided by skills (`.claude/skills/eta-app`) to adopt eta's paradigm.
2. **Duplicate Permission Declarations**: The AI writes who can do what in `stories.ts`, and then has to manually duplicate those rules in `compartment.ts` (`permit()`).
3. **Hand-Crafted Markup**: Until Track D (`n2`, wedding venues), every view had to be written by hand as template strings. Writing standard CRUD tables and forms by hand wastes tokens and introduces minor markup errors.
4. **Form Wiring Mechanics**: Remembering wire attributes (`data-write-on="blur"`, `name="/path"`, `:user-invalid`, `role="status"`) requires meticulous memory of kernel conventions.
5. **Opaque Wiring Errors**: When a socket update doesn't arrive because the view forgot to call `read()`, the AI has to deduce why the page stayed still.

---

## 5. Five Proposals to Make eta the Path of Least Resistance

To make eta the effortless, natural default for AI application development:

### 1. Derive the Permit Table from Stories (`todo.jsonl #32`)
The stories already state intent:
- `Ada.does("asks for leave").sends(teamDoc, "add", "/requests/-", ...)`
- `Ada.cannot("approve leave").sends(teamDoc, "replace", "/requests/0/status", ...)`

The kernel or harness can derive or verify the compartment's `permit()` table directly from the stories. The AI should not write permissions twice.

### 2. Schema-Driven Bento Views (`todo.jsonl #2`)
Take Track D (`n2`) to its logical conclusion:
- Define the table schema and document shape in `delta.ts`.
- The kernel provides default derived views for standard shapes (lists, detail cards, edit forms, choice dropdowns).
- The AI only writes custom HTML for bespoke interactive features (e.g., the ticker clock, the Lego minifigure builder). 80% of standard views require zero template code.

### 3. Diagnostic Harness Errors Formatted for LLMs
Make `bun run stories` output compiler-grade diagnostic hints when a story fails:
```
FAIL: Mo did not see Ada's request on the calendar.
Hint: 'views/calendar.ts:24' never called read('team:1').
      The socket connection was never registered to receive updates for this document.
```
When error messages explain the exact missing seam, the AI fixes the code on the first attempt without guessing.

### 4. Semantic Bento Form & Field Helpers
Provide typed helper functions in `src/bento.ts` (e.g., `bento.field(draft, "/note", { label: "Note", on: "blur" })`) that automatically emit:
- Proper JSON Pointer paths
- Correct `data-write-on` debouncing
- Native accessibility attributes (`aria-describedby`, `:user-invalid`, `role="status"`)
- Consistent semantic styling

This halves the token length of views and eliminates attribute bugs.

### 5. Model-First App Generation (`bun run model`)
Turn `examples/modeling` into the primary development loop:
1. Human and AI talk through the user stories.
2. The modeler derives the documents, compartments, and story boundaries.
3. A scaffold command generates the clean eta app structure.
4. The AI fills in the minimal domain logic to make `bun run stories` pass.

---

## The Verdict

If software is fundamentally **people reading shared documents, making gestures to change them, and seeing the results in real time across all their devices**, then eta is the shortest possible path from thought to working code.

By letting stories derive permissions, letting document schemas derive standard views, and giving the AI clear diagnostic feedback, eta can become the definitive environment for AI-built collaborative applications.

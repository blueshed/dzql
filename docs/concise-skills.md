# Concise Skills: The Compass, Not the Encyclopedia

> **"The types are the contract. The tests are the proof. The skill is only the compass."**

Skills were created to guide AI agents through complex domains. But across the Blueshed ecosystem, skills have accumulated so much historical context, type repetition, and narrative exposition that they now act as a cognitive tax on the very agents they were designed to help.

---

## 1. The Numbers: Drowning in Reference Words

A survey of the skill files currently loaded across the stack:

| Skill | Primary `SKILL.md` | Monolithic `reference.md` | Total Tokens (approx) |
|---|---|---|---|
| **`eta-app`** | 523 words | **11,407 words** | ~15,500 tokens |
| **`delta-doc`** | 2,206 words | **20,606 words** | ~29,500 tokens |
| **`railroad`** | 1,332 words | **5,125 words** | ~8,400 tokens |
| **`bun-route`** | 1,024 words | **2,169 words** | ~4,100 tokens |
| **Total Stack** | 5,085 words | **39,307 words** | **~57,500 tokens** |

When an agent loads `reference.md` to answer a question or write a single feature, it consumes **30% to 50% of its working memory** before inspecting a single project file.

---

## 2. The Four Disasters of Bloated Skills for AI

### 1. Attention Dilution ("Lost in the Middle")
LLMs do not read like humans; every token in context competes for attention during autoregressive generation. 
When non-negotiable rules (*“Never import an icon set into the kernel”*, *“Always call `read()` in views”*, *“Permits check op and path”*, *“100% test coverage gate”*) are embedded inside 11,000 words of background rationale, 2013 Genoa history, and edge-case disclaimers, the model loses the signal. Critical invariants are missed.

### 2. Re-transcribing Types into Markdown
A massive portion of `reference.md` consists of English sentences describing function arguments, return signatures, and options tables.
- TypeScript types (`src/compartments/compartment.ts`, `src/documents.ts`) are **machine-readable, compiler-verified, and completely unambiguous**.
- Re-transcribing types into markdown documentation is an anti-pattern: it bloats the prompt, falls out of date as soon as code changes, and teaches the AI to guess from prose instead of inspecting the types.

### 3. The Monolithic Context Tax
`eta-app/SKILL.md` is actually well-sized (523 words). However, it immediately directs the agent to `reference.md`: an 11,400-word monolith.
If an agent only needs to know how to write a `permit()` function, it has to ingest explanations of WebKit tests, WebSocket permessage-deflate compression, CLI subcommands, and URL routing.

### 4. Skill Shadowing and Description Hijacking (`todo.jsonl #21`)
As noted in open issue `n21`, `delta-doc`’s description is so broad that it captures every generic "live multi-user app" prompt before `eta` or `railroad` are even considered. Without a concise router, agents load the wrong massive skill for the job.

---

## 3. The Lean Standard for AI Skills

To make skills fast, high-signal, and token-efficient:

### Rule 1: The 600-Word Ceiling for `SKILL.md`
The top-level `SKILL.md` must be read in under 600 words. It should contain only:
1. **The Mental Model**: $\text{Stories} \longrightarrow \text{Documents} \longrightarrow \text{Views}$.
2. **The 4-Step Order of Work**:
   - Write story in `stories.ts` (watch it fail).
   - Define schema and seed in `delta.ts`.
   - Implement compartment permissions (`permit`, `shape`) in `compartments/`.
   - Render server HTML in `views/`.
3. **The Non-Negotiable Invariants** (e.g., 100% coverage gate, no client domain state).
4. **Signposts to Code Types** (e.g., *"The contract is `src/compartments/compartment.ts`"*).

### Rule 2: Progressive Disclosure (Break the Monolith)
Retire the monolithic 11,400-word `reference.md`. Replace it with small, topic-specific reference files (200–400 words each) loaded on demand:
```
.claude/skills/eta-app/
├── SKILL.md                  # ~500 words (the compass)
└── reference/
    ├── stories.md            # ~350 words: how to write stories & cannot
    ├── compartment.md        # ~350 words: permit, shape, and writes
    ├── bento.md              # ~300 words: trays, cells, and tokens
    ├── wire.md               # ~250 words: patches, morph, and read()
    └── applets.md            # ~300 words: when to use railroad islands
```
An agent modifying a view only reads `bento.md` (300 words) instead of the entire 11,400-word encyclopedia.

### Rule 3: Canonical Micro-Archetypes Over Prose Explanations
LLMs learn syntax and contracts an order of magnitude faster from a single 20-line canonical code example than from four pages of English text. 
Each reference topic should lead with **one minimal, complete example**:
- One complete 15-line `compartment.ts`.
- One complete 12-line `view.ts`.
- One complete 8-line `story.ts`.

### Rule 4: Pointers to Types, Not Re-Typed Tables
Never write an options table in markdown when the TypeScript interface already exists.
Instead of:
> *"The options object takes `tag` (string, optional, defaults to 'div'), `under` (string, the json pointer path)..."*

Write:
> *"See `AppletProps` in `src/applets.ts` for all supported options."*

### Rule 5: A Single Blueshed Router Skill (<500 Words)
Resolve `todo.jsonl #21` by introducing a top-level router skill:
- **Need live multi-user apps, presence, views, and undo?** $\longrightarrow$ **eta**
- **Need headless document synchronization, CRDTs, or Postgres ledger?** $\longrightarrow$ **delta**
- **Need reactive client components or islands?** $\longrightarrow$ **railroad**

---

## 4. Summary

An AI does not need a textbook; it needs a **cheat sheet and a compiler**.

By enforcing a 600-word ceiling on `SKILL.md`, splitting references into modular topic files under 400 words, and letting TypeScript types act as the sole source of truth for contracts, we can cut skill context consumption by **80%**, eliminate attention degradation, and dramatically speed up agent execution.

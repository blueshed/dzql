# The Philosophy: Behavioral Compilers & Deterministic Patterns

## The Problem: The "Boilerplate Trap"
Building real-time apps at scale using just CRUD and subscriptions allows for too much variance. Manually writing event handlers for every interaction leads to unmaintainable N² complexity. Asking AI to generate this code results in subtle bugs and non-repeatable outcomes because the abstraction level is too low (it's "assembly language").

## Where dzql Stands: delta's Compiled Step (October 2026)
The design path is **stories → documents → entities**. A story is something a person wants to do; a document is what they need in front of them to do it; the tables follow from the documents. [@blueshed/delta](https://github.com/blueshed/delta) keeps the documents and their storage grows along one path: a JSON file, SQLite, Postgres in the process, a Postgres server. **dzql is the last step: compiled Postgres.**

- **The input is the app's own definitions.** dzql reads delta's `defineSchema` and `defineDoc`, the same ones the app had on SQLite, so moving to dzql changes where the truth lives, never the app.
- **The wire is delta's.** A client talks to a dzql server exactly as to a SQLite one, so dzql may be as large and as opinionated as it likes behind it.
- **Claude writes the compiler; Claude is never the compiler.** The compiler is deterministic: the same definitions give the same SQL, byte for byte. A case it cannot compile is an error naming what it lacks, never SQL that half works; Claude extends the compiler for it, with tests.
- **delta's cases are the proof.** dzql runs delta's published cases (`@blueshed/delta/testing`) unchanged: what a person is sent, every backend's error table, write scope, the law over generated writes. A compiled function is right when it answers what delta answers. A backend that answers differently is the bug.
- **Permissions are a document's.** Who may open a document is a path from its row to the person (`owns`, written in dzql's path language), never a rule on a table; row-level security is derived from the documents, not written.
- **Migrations stay delta's.** An app has one list of migrations whatever it runs on; dzql brings no upgrade scheme of its own.

The plan, step by step, is Workshop's `docs/postgres-split-plan.md`.

## The Vision: Patterns as Infrastructure
Instead of writing documents and their rules by hand, define systems as a composition of **Deterministic Patterns**: still the direction, now over documents rather than entities.

### The "Behavioral Compiler"
A "Compiler for Intent", where we describe **Behaviors**, not just data shapes.

```typescript
export const app = compose(
  // Pattern: Workflow
  // Deterministically gives: the states, the documents each actor watches, who may move it on
  Workflow({
    root: 'tickets',
    states: ['triage', 'working', 'done'],
    transitions: { ... }
  }),

  // Pattern: Activity Stream
  // Deterministically gives: the feed's document, and every change that reaches it
  ActivityStream({
    actor: 'user',
    subjects: ['tickets']
  })
);
```

A pattern lowers to delta's definitions (a schema, documents, their `owns`), and the compiler lowers those to SQL; nothing in a pattern bypasses the documents.

## Why This Solves the "AI Problem"
1.  **Constrained AI**: The AI writes and extends the compiler, then selects and configures patterns; it doesn't invent the SQL of each app.
2.  **Binary Outcomes**: The compiler either accepts the definitions or rejects them, naming why. No "mostly works" states.
3.  **Deterministic Code**: The same definitions *always* give the exact same SQL.
4.  **Proven, not assumed**: delta's own cases run against what was compiled, so "it works" means the same answers as every other backend.

## The Goal
To stop writing "features" and start composing "behaviors" that bring their own documents and real-time logic with them. This moves us from "AI writing code" to "AI writing the compiler, and configuring reliable systems with it."

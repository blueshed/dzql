# The Philosophy: Behavioral Compilers & Deterministic Patterns

## The Problem: The "Boilerplate Trap"
Building real-time apps at scale using just CRUD and Subscribables allows for too much variance. Manually writing event handlers for every interaction leads to unmaintainable N² complexity. Asking AI to generate this code results in subtle bugs and non-repeatable outcomes because the abstraction level is too low (it's "assembly language").

## The Vision: Patterns as Infrastructure
Instead of writing entities and graph rules manually, we should define systems as a composition of **Deterministic Patterns**.

### The "Behavioral Compiler"
We need a "Compiler for Intent" where we describe **Behaviors**, not just data shapes.

```typescript
export const domain = compose(
  // Pattern: Workflow
  // Deterministically generates: State machine table, transition permissions, notification rules
  Workflow({
    entity: 'ticket',
    states: ['triage', 'working', 'done'],
    transitions: { ... }
  }),

  // Pattern: Activity Stream
  // Deterministically generates: Feed tables, fan-out graph rules, subscription keys
  ActivityStream({
    actor: 'user',
    subjects: ['ticket']
  })
);
```

## Why This Solves the "AI Problem"
1.  **Constrained AI**: The AI only selects and configures patterns; it doesn't invent the SQL or logic.
2.  **Binary Outcomes**: The compiler either accepts the configuration or rejects it. No "mostly works" states.
3.  **Deterministic Code**: The `Workflow` function *always* outputs the exact same consistent schema and rules.

## The Goal
To stop writing "features" and start composing "behaviors" that bring their own data structure and real-time logic with them. This moves us from "AI writing code" to "AI configuring reliable systems."

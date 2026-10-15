import { createLocal } from "@blueshed/delta/local";

// Starter's documents, in delta (`@blueshed/delta`): none yet. The first story says which document
// a person needs in front of them to act, and who is told when it changes; its schema, its seed and
// its registration go here (the eta-app skill, and delta's own `delta-doc` skill). With the first schema,
// the order at start-up is migrate (this app's `migrations/`, given `{ app, schema }`), then createTables,
// then migrateSchema: reference/migrations.md.
export const delta = createLocal();

# DZQL Generated Code TypeScript Issues

## Summary

The generated client code in `generated/client/ws.ts` and the Pinia stores have TypeScript errors that prevent `vue-tsc` from passing type checks. The runtime works fine, but strict type checking fails.

## Environment

- dzql: ^0.6.24
- TypeScript: ~5.9.3
- Vue: ^3.5.24
- Pinia: ^3.0.4

---

## Issue 1: DzqlAPI Subscribe Method Return Type Mismatch

**File:** `generated/client/ws.ts:3503`

**Error:**
```
error TS2352: Conversion of type '{ ... subscribe_venue_my_venues: (params: any, callback: (data: any) => void) => Promise<...>; }' to type 'DzqlAPI' may be a mistake because neither type sufficiently overlaps with the other.
  The types returned by 'subscribe_contractorCatalogue_my_catalogue(...)' are incompatible between these types.
    Type 'Promise<() => void>' is not comparable to type 'Promise<{ data: ContractorCatalogueMyCatalogueResult; subscription_id: string; schema: unknown; unsubscribe: () => Promise<void>; }>'.
```

**Cause:** The `DzqlAPI` interface defines subscribe methods as returning:
```typescript
Promise<{ data: T; subscription_id: string; schema: unknown; unsubscribe: () => Promise<void>; }>
```

But the actual implementation returns `Promise<() => void>` from `this.subscribe()`.

**Suggested Fix:** Either update the `DzqlAPI` interface to match the actual return type, or update the `subscribe` method in `WebSocketManager` to return the full subscription object.

---

## Issue 2: Missing `process` Type in Browser Context

**File:** `node_modules/dzql/src/client/ws.ts:16-17`

**Error:**
```
error TS2591: Cannot find name 'process'. Do you need to install type definitions for node?

16   if (typeof process !== 'undefined' && process.env?.DZQL_TOKEN_NAME) {
17     return process.env.DZQL_TOKEN_NAME;
```

**Cause:** The client WebSocket code references `process.env` which doesn't exist in browser environments. While the runtime check `typeof process !== 'undefined'` prevents runtime errors, TypeScript still flags this as an error in DOM-only type contexts.

**Suggested Fix:** Use a type guard or declare the type:
```typescript
declare const process: { env?: Record<string, string | undefined> } | undefined;
```

Or use a more browser-friendly approach:
```typescript
if (typeof globalThis !== 'undefined' && 'process' in globalThis) {
  // ...
}
```

---

## Issue 3: Undefined Index Type in Array Access

**File:** `node_modules/dzql/src/client/ws.ts:248, 253`

**Error:**
```
error TS2538: Type 'undefined' cannot be used as an index type.

248       target = target?.[parts[i]];
253     const arr = target[key];
```

**Cause:** When iterating with `parts[i]`, TypeScript infers that `parts[i]` could be `undefined` if `i` exceeds the array bounds. Similarly, `key` from `parts.pop()` could be `undefined`.

**Suggested Fix:** Add explicit checks or use non-null assertions where appropriate:
```typescript
const part = parts[i];
if (part !== undefined) {
  target = target?.[part];
}
```

Or if the logic guarantees values exist:
```typescript
target = target?.[parts[i]!];
```

---

## Issue 4: Unused Variables in Store Handlers

**File:** `node_modules/dzql/src/client/ws.ts:320`

**Error:**
```
error TS6133: 'handler' is declared but its value is never read.
error TS6133: 'params' is declared but its value is never read.

320     const handler = (params: any) => {
```

**Cause:** Variables are declared but not used in the generated code.

**Suggested Fix:** Either use the variables, prefix with underscore (`_handler`, `_params`), or remove them if unnecessary.

---

## Issue 5: Generated Pinia Stores Missing Dependencies

**File:** `generated/client/stores/use*.ts`

**Error:**
```
error TS2307: Cannot find module 'pinia' or its corresponding type declarations.
error TS2307: Cannot find module 'vue' or its corresponding type declarations.
```

**Cause:** The generated store files import from `pinia` and `vue`, but these are peer dependencies that may not be resolved when type-checking the generated folder directly.

**Suggested Fix:** The stores should either:
1. Include a `tsconfig.json` in the generated folder that extends the consuming project's config
2. Or the consuming project should only include the specific files needed (ws.ts, index.ts) rather than the entire generated folder

---

## Workaround

For now, the client uses `skipLibCheck: true` and only includes `src/**/*.ts` in the TypeScript include paths, running `vite build` without `vue-tsc` type checking. The type checking can be run separately with `bun run typecheck` but will fail due to these issues.

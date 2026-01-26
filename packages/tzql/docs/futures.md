# Future Performance & Architecture Roadmap

This document tracks architectural improvements to ensure DZQL remains performant and scalable as application complexity grows.

## 1. The "Mega-JSON" Memory Trap
**Status:** ⚠️ Potential Bottleneck

Currently, subscribables that return lists (e.g., `search_`, `my_venues`) aggregate the entire result set into a single `jsonb` blob inside PostgreSQL memory before returning it.

- **Problem:** Aggregating 10,000+ items into one JSON string causes memory spikes in the database and prevents streaming. It also risks hitting the 1GB field limit.
- **Solution:** Refactor generated SQL functions to return `SETOF jsonb`.
- **Benefit:** Allows the Node.js runtime to stream rows to the client as they are read from the disk, maintaining a constant memory footprint regardless of result size.

## 2. Decoupled Notifications
**Status:** ⚠️ Performance Risk

Notification recipient resolution (e.g., `@org_id->acts_for...`) currently runs synchronously inside the `save_` and `delete_` transactions.

- **Problem:** A single insert can trigger a heavy query to find hundreds of recipients, holding locks on the primary table until the notification logic completes.
- **Solution:** Move notification resolution out of the transaction. The `save_` function should simply emit an event, and a background worker (or separate PL/pgSQL trigger on the events table) should resolve recipients.
- **Benefit:** Dramatically faster write response times and reduced row contention.

## 3. Logical Replication (WAL) Integration
**Status:** 📈 Optimization

DZQL currently uses "Double Writing" (writing to the target table + writing to an `events` table).

- **Problem:** Halves write throughput and leads to database bloat in the `events` table.
- **Solution:** Switch to PostgreSQL Logical Replication. Use a replication slot to stream changes directly from the WAL (Write-Ahead Log).
- **Benefit:** Eliminates the need for the `events` table and the `compute_affected_keys` calculation at write time, reaching near-native PostgreSQL performance.

## 4. Prepared Statement Cache
**Status:** 🚀 Enhancement

The `search_` functions currently use dynamic SQL via `EXECUTE format(...)`.

- **Problem:** PostgreSQL must re-parse and re-plan the query every time a search is performed with different filters.
- **Solution:** Implement a query plan cache or transition to parameterized queries for common filter patterns.
- **Benefit:** Reduces CPU overhead on the database for high-frequency search operations.

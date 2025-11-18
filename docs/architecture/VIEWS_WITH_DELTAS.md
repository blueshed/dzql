# Architecture: Real-Time View Subscriptions with Deltas

This document outlines the design for a third, highly-optimized real-time pattern for DZQL: **Delta Streams for View Subscriptions**. This pattern complements the existing "Document Push" and "Live Query" models by providing an extremely network-efficient way to synchronize large collections of data with clients.

## The Three Real-Time Patterns

To understand the value of Delta Streams, it's helpful to compare it with the other two real-time patterns available in DZQL.

1.  **Pattern 1: The "Document" Push (Entity Subscription)**
    *   **Contract:** "You are viewing a specific *document*. When it changes, I will send you the complete, new version of that document."
    *   **Best For:** Detail screens, forms, or any UI component bound to a single entity.

2.  **Pattern 2: The "Live Query" (Full Result Set Push)**
    *   **Contract:** "You are subscribed to a *query*. When any underlying data changes the result, I will re-run the entire query and send you the complete, new result set."
    *   **Best For:** Dashboards, analytics, or complex, aggregated views.

3.  **Pattern 3: The "Delta Stream" (This Proposal)**
    *   **Contract:** "You are subscribed to the *contents of this view*. When the contents change, I will send you a tiny message describing *exactly what changed* (the delta)."
    *   **Best For:** Long lists, tables, or feeds where the client maintains a large local collection and only needs to be told which items to add, remove, or update.

## Proposed API

### 1. SQL Definition

A developer would define a standard PostgreSQL `VIEW` and then register it with DZQL, specifying a "delta" update mode.

```sql
-- First, define a standard PostgreSQL view
CREATE VIEW public.active_posts_summary AS
  SELECT id, title, author_id, created_at
  FROM posts
  WHERE deleted_at IS NULL AND published_at IS NOT NULL;

-- Then, register the view with DZQL for delta subscriptions
SELECT dzql.register_view_subscription(
  'active_posts_summary', -- The name of the PostgreSQL VIEW
  'id',                   -- The unique key for records within the view
  'delta'                 -- The update mode
);
```

### 2. Client-Side Subscription

The client would subscribe to the named view and receive a stream of delta objects.

```javascript
// The client subscribes once to get the initial list and future deltas.
const { initial_data, unsubscribe } = await ws.api.subscribe_view.active_posts_summary(
  {}, // Optional filters for the view
  (delta) => {
    // This callback fires with each subsequent change.
    // The client-side library is responsible for applying the delta.
    console.log(delta);
    // Example delta: { "op": "add", "id": 456, "data": { id: 456, title: 'New Post', ... } }
    // Example delta: { "op": "update", "id": 123, "data": { title: 'Updated Title' } }
    // Example delta: { "op": "remove", "id": 789 }
  }
);
```

## Core Implementation Strategy

The power of this pattern comes from a sophisticated compiler that pushes the complex delta-calculation logic into the database itself.

1.  **The Compiler's Role (Analysis)**
    When `dzql.register_view_subscription` is called, the DZQL compiler will analyze the `active_posts_summary` view definition. It will parse the SQL to identify its dependencies (the `posts` table) and, crucially, the logic within its `WHERE` clause (`deleted_at IS NULL AND published_at IS NOT NULL`).

2.  **The Compiler's Role (Code Generation)**
    The compiler will automatically generate a highly specific trigger function and attach it to the underlying `posts` table. This is the core of the implementation.

3.  **The Delta-Calculating Trigger**
    This generated trigger is the "brain" of the operation. On every `INSERT`, `UPDATE`, or `DELETE` on the `posts` table, the trigger will execute logic to determine the delta's impact on the `active_posts_summary` view:
    *   It compares the `OLD` and `NEW` state of the row against the view's `WHERE` clause.
    *   **`add` operation:** If the row didn't match the `WHERE` clause before but does now (e.g., `published_at` was just set to `NOW()`), the trigger determines this is an `add` event for the view's result set.
    *   **`remove` operation:** If the row matched before but no longer does (e.g., `deleted_at` was just set), the trigger determines this is a `remove` event.
    *   **`update` operation:** If the row matched before and still matches, the trigger determines this is an `update` event.
    *   **No operation:** If the row didn't match before and still doesn't, nothing happens.

4.  **The Notification Payload**
    The trigger will then format a precise JSONB payload describing the change and use `pg_notify` to send it to a dedicated channel.
    `NOTIFY dzql_delta_updates, '{"view": "active_posts_summary", "op": "add", "id": 456, "data": {...}}'`

5.  **Central Handler & Client Update**
    A central DZQL server process listens on the `dzql_delta_updates` channel. When it receives a delta notification, it relays that exact JSON payload to all WebSocket clients currently subscribed to the `active_posts_summary` view.

## Benefits

*   **Extreme Network Efficiency:** Sending a tiny delta message is vastly more efficient than re-sending an entire list of thousands of items.
*   **Scalability:** This allows the server to support many more concurrent clients, as the per-update cost is minimal.
*   **Reduced Client-Side Load:** Surgically applying a small change to a local data store is often much faster for the client's UI than diffing and re-rendering an entire new list.

## Challenges

*   **Compiler Complexity:** The compiler needs to be sophisticated enough to parse a wide variety of SQL `VIEW` definitions and correctly generate the corresponding delta-logic triggers.
*   **Client-Side State Management:** The client application must be able to manage a local cache and correctly apply the incoming `add`, `update`, and `remove` delta operations.
*   **Initial Data Load:** The initial subscription still requires sending the full data set once. The delta mechanism only applies to subsequent updates.

## Conclusion

The "Delta Stream" pattern is a powerful, high-performance feature that aligns perfectly with DZQL's philosophy of leveraging the database for maximum efficiency. While complex to implement, it would provide a significant competitive advantage and enable a new class of highly scalable, real-time applications to be built on the framework. It should be considered a key feature on the long-term roadmap.

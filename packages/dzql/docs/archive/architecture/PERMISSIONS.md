# DZQL Permission Path DSL Specification

**Audience: AI Assistant**

This document provides the formal technical specification for the Domain Specific Language (DSL) used to define permission and notification paths within the `dzql.register_entity` function. Use this specification for deterministic code generation.

## 1. Formal Grammar (EBNF-style)

A permission path is a string that must conform to the following grammar:

```ebnf
path            ::= "@" column_name ( traversal )*
traversal       ::= "->" relation_name ( filter )? ( temporal )? ( projection )?
filter          ::= "[" column_name "=" ( literal | variable ) "]"
temporal        ::= "{active}"
projection      ::= "." column_name

column_name     ::= identifier
relation_name   ::= identifier
identifier      ::= [a-zA-Z_][a-zA-Z0-9_]*

literal         ::= number | "'" string "'"
variable        ::= "$"
```

**Critical Note on Quote Escaping in Permission Paths**:

Permission paths are stored as PostgreSQL text array literals (e.g., `array['path1', 'path2']`). This creates a **double-escaping requirement** when using string literals in filters:

1. **Inside the filter**, you need single quotes around string values: `[role='editor']`
2. **Inside the array literal**, single quotes must be doubled: `array['...[role=''editor'']...']`

**Why the double escaping?**
- The outer `array['...']` is a PostgreSQL text array literal
- Inside that literal, `''` represents a single `'` character
- So `''editor''` inside the array becomes `'editor'` in the actual path string
- Which gives you the filter `role='editor'` when parsed

**Examples of correct escaping**:
```sql
-- CORRECT: Filter for role='editor'
array['@user_id->users[role=''editor''].id']
-- This becomes the path: @user_id->users[role='editor'].id

-- CORRECT: Filter for status='active'  
array['@id->tasks[status=''active''].owner_id']
-- This becomes the path: @id->tasks[status='active'].owner_id

-- CORRECT: Using variables (no quotes needed)
array['@org_id->members[org_id=$].user_id']
-- Variables use $ and don't need string quotes
```

**Visual guide**:
- `editor` - the string value you want to match
- `'editor'` - how it appears in SQL: `WHERE role='editor'`
- `''editor''` - how it appears in the array literal: `array['...role=''editor''...']`

## 2. Core Concepts

- **Purpose**: To define which users have `view`, `create`, `update`, or `delete` permissions for an entity. The same paths are used to determine which users receive real-time notifications.
- **Evaluation**: Paths are evaluated at query time against the specific row (entity instance) being accessed.
- **Context**: The root of any path is the entity on which the permission is being defined.

## 3. Resolution Semantics

- Each path string in the permissions array **must** resolve to a single `user_id` (integer) or an array of `user_id`s.
- The final set of authorized users is the flattened, unique union of all `user_id`s returned by every path in the array for a given permission level (e.g., `view`).
- If a path or any part of a traversal yields no result (e.g., a relation is not found or a filter returns no rows), it resolves to an empty set and contributes no `user_id`s. It does not produce an error.

## 4. Syntax and Components

#### **Prerequisite: Relation Definitions**
The `->` traversal operator relies on the `relations` JSONB object defined in `dzql.register_entity`. Each key in this object is a `relation_name` that can be used in a path. The value is the name of the target entity being linked to.

**Example `relations` object:**
```json
{
  "creator": "users",
  "logs": "streak_logs",
  "shares": "streak_shares"
}
```
In this example, `->creator`, `->logs`, and `->shares` are all valid traversals from the root entity. For more detail, see the `dzql.register_entity` definition in `REFERENCE.md`.

---

#### **Path Components**

| Component | Grammar | Description |
| :--- | :--- | :--- |
| **Start** | `@` column_name | Every path must begin with `@` followed by a column name on the root entity. |
| **Traversal** | `->` relation_name | Traverses a named relationship to a related entity or view. |
| **Projection** | `.` column_name | Selects a single column from the current entity in the traversal. The final projection in a path must resolve to a `user_id`. |
| **Filter** | `[` filter `]` | Filters the rows of a traversed relationship. See Filter Syntax below. |
| **Temporal Filter** | `{active}` | Filters the traversed relationship to only include currently active rows based on the entity's `temporal_fields` configuration. Requires `valid_from` and `valid_to` fields. Only rows where `valid_from <= NOW() AND (valid_to > NOW() OR valid_to IS NULL)` are included. |

---

#### **Filter Syntax**
The filter expression is used to narrow down the results of a `->` traversal.

- **Structure**: `column_name = value`
- **Operator**: Only the equality operator (`=`) is supported.
- **Left-hand Side**: Must be a valid `column_name` on the entity being filtered.
- **Right-hand Side**: Can be one of two types:
    1.  **Literal**: A fixed value.
        -   **String literals** must be enclosed in single quotes and properly escaped per standard SQL syntax (e.g., `'editor'`, `'O''Malley'`).
        -   **Numeric literals** do not require quotes (e.g., `123`).
    2.  **Variable**: The `$` symbol is the only supported variable. It represents the `user_id` of the user making the current API request.

## 5. Common Patterns & Examples

---

### Example 1: Simple Ownership
**Goal**: Only the user whose ID is in the `user_id` column can access.
**Path**: `array['@user_id']`
**Explanation**: Directly resolves to the value in the `user_id` column.

---

### Example 2: Parent Relationship
**Goal**: For a `comments` entity with a `post_id`, grant access to the owner of the parent `posts` entity.
**Path**: `array['@post_id->posts.user_id']`
**Explanation**: Traverses from the comment's `post_id` to the `posts` entity via the `posts` relation, then projects the `user_id` from the post.

---

### Example 3: Filtered Relationship (Role-Based)
**Goal**: Grant access to any user who has the role of "editor".
**Path**: `array['@user_id->users[role=''editor''].id']`
**Explanation**: Traverses to the `users` entity, filters for rows where `role` is the string literal `'editor'`, and projects their `id`. Note the doubled single quotes (`''`) to escape the quote inside the string literal.

---

### Example 4: Many-to-Many (Mutual Connections)
**Goal**: Grant access to users who have a mutual connection with the entity's owner, using the `$` variable to represent the current user.
**Path**: `array['@user_id->mutual_connections[user1_id=$].user2_id', '@user_id->mutual_connections[user2_id=$].user1_id']`
**Explanation**: This uses two paths to check both directions of the relationship against the current user (`$`).
- The first path checks if the current user is `user1_id` and returns the corresponding `user2_id`.
- The second path checks if the current user is `user2_id` and returns the corresponding `user1_id`.

---

### Example 5: Combining Permissions
**Goal**: Grant access to the owner OR any editors.
**Path**: `array['@user_id', '@user_id->users[role=''editor''].id']`
**Explanation**: The final permission set is the union of all resolved `user_id`s. This grants access to the post's owner AND to anyone with the 'editor' role.

---

### Example 6: Temporal Filtering (Active Relationships Only)
**Goal**: Grant access only to users who currently have active organization memberships.
**Path**: `array['@org_id->acts_for[org_id=$]{active}.user_id']`
**Explanation**:
- `@org_id` - Start with the organization ID from the current entity
- `->acts_for` - Traverse to the `acts_for` relationship
- `[org_id=$]` - Filter to memberships for this organization where the user is the current user
- `{active}` - Further filter to only currently active memberships (based on `valid_from`/`valid_to`)
- `.user_id` - Project the user ID from the membership

**Prerequisites**: The `acts_for` entity must be registered with temporal fields:
```sql
SELECT dzql.register_entity(
  'acts_for',
  -- ... other params ...
  jsonb_build_object('valid_from', 'valid_from', 'valid_to', 'valid_to'),  -- temporal_fields (5th param)
  -- ... permission paths ...
);
```

**Temporal Logic**: A row is considered "active" if:
```sql
valid_from <= CURRENT_DATE 
AND (valid_to > CURRENT_DATE OR valid_to IS NULL)
```

**Use Case**: This pattern is commonly used for:
- Role-based access that changes over time (contractors, temporary employees)
- Share connections that can be opened and closed
- Subscriptions with start and end dates

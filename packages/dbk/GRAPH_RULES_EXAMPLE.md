# Graph Rules for Double-Entry Bookkeeping

This document shows how to use the extended graph rules (validation and execute actions) for accounting.

## Prerequisites

The new graph rules features require migration `010_graph_rules_validation.sql` to be applied.

## Entity Registration with Validation Rules

### Journal Entries

```sql
-- Register journal_entries entity with validation rules
SELECT dzql.register_entity(
  'journal_entries',
  'description',
  array['description', 'entry_date'],
  '{}',
  false,  -- soft delete
  '{}',   -- temporal fields
  '{"org": ["@org_id->users[org_id=$].user_id"]}',  -- notifications
  '{
    "view": ["@org_id->users[org_id=$].user_id"],
    "create": ["@org_id->users[org_id=$].user_id"],
    "update": ["@org_id->users[org_id=$].user_id"],
    "delete": ["@org_id->users[org_id=$].user_id"]
  }',
  '{
    "on_update": {
      "validate_before_posting": {
        "description": "Validate entry is balanced before posting",
        "condition": "@after.status = ''posted'' AND @before.status = ''draft''",
        "actions": [
          {
            "type": "validate",
            "function": "validate_journal_entry_balanced",
            "params": {"entry_id": "@id"},
            "error_message": "Cannot post unbalanced journal entry - debits must equal credits"
          },
          {
            "type": "validate",
            "function": "validate_period_open",
            "params": {"period_id": "@after.fiscal_period_id"},
            "error_message": "Cannot post to a closed fiscal period"
          }
        ]
      },
      "update_balances_on_post": {
        "description": "Update account balances when entry is posted",
        "condition": "@after.status = ''posted'' AND @before.status != ''posted''",
        "actions": [
          {
            "type": "execute",
            "function": "update_account_balances_for_entry",
            "params": {
              "entry_id": "@id",
              "user_id": "@user_id"
            }
          }
        ]
      },
      "prevent_modify_posted": {
        "description": "Prevent modification of posted entries",
        "condition": "@before.status = ''posted''",
        "actions": [
          {
            "type": "validate",
            "function": "always_false",
            "params": {},
            "error_message": "Cannot modify posted journal entry - unpost first"
          }
        ]
      }
    },
    "on_delete": {
      "prevent_delete_posted": {
        "description": "Prevent deletion of posted entries",
        "condition": "@before.status = ''posted''",
        "actions": [
          {
            "type": "validate",
            "function": "always_false",
            "params": {},
            "error_message": "Cannot delete posted journal entry"
          }
        ]
      },
      "reverse_balances": {
        "description": "Reverse account balance updates when deleting draft entry",
        "condition": "@before.status = ''draft''",
        "actions": [
          {
            "type": "execute",
            "function": "reverse_account_balances_for_entry",
            "params": {"entry_id": "@id"}
          }
        ]
      }
    }
  }'
);
```

## Required PostgreSQL Functions

### Validation Functions

```sql
-- Validate that journal entry debits equal credits
CREATE OR REPLACE FUNCTION validate_journal_entry_balanced(entry_id INT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE AS $$
  SELECT
    COALESCE(SUM(debit_amount), 0) = COALESCE(SUM(credit_amount), 0)
  FROM journal_lines
  WHERE journal_entry_id = entry_id;
$$;

-- Validate that fiscal period is open
CREATE OR REPLACE FUNCTION validate_period_open(period_id INT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE AS $$
  SELECT status = 'open'
  FROM fiscal_periods
  WHERE id = period_id;
$$;

-- Always return false (for unconditional rejection)
CREATE OR REPLACE FUNCTION always_false()
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE AS $$
  SELECT false;
$$;
```

### Execution Functions

```sql
-- Update account balances when journal entry is posted
CREATE OR REPLACE FUNCTION update_account_balances_for_entry(
  entry_id INT,
  user_id INT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  l_line RECORD;
BEGIN
  -- Loop through all journal lines for this entry
  FOR l_line IN
    SELECT account_id, debit_amount, credit_amount
    FROM journal_lines
    WHERE journal_entry_id = entry_id
  LOOP
    -- Update account balance
    -- Debits increase asset/expense accounts, credits decrease them
    -- Credits increase liability/equity/revenue accounts, debits decrease them
    UPDATE accounts
    SET balance = balance + COALESCE(l_line.debit_amount, 0) - COALESCE(l_line.credit_amount, 0)
    WHERE id = l_line.account_id;
  END LOOP;
END $$;

-- Reverse account balance updates (for deletions or unposting)
CREATE OR REPLACE FUNCTION reverse_account_balances_for_entry(entry_id INT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  l_line RECORD;
BEGIN
  FOR l_line IN
    SELECT account_id, debit_amount, credit_amount
    FROM journal_lines
    WHERE journal_entry_id = entry_id
  LOOP
    -- Reverse the balance update
    UPDATE accounts
    SET balance = balance - COALESCE(l_line.debit_amount, 0) + COALESCE(l_line.credit_amount, 0)
    WHERE id = l_line.account_id;
  END LOOP;
END $$;
```

## How It Works

### Scenario 1: Posting a Balanced Entry

```javascript
// 1. Create draft entry
const entry = await db.api.save.journal_entries({
  description: "Office rent payment",
  entry_date: "2025-01-15",
  org_id: 1,
  fiscal_period_id: 5,
  status: "draft"
}, userId);

// 2. Add journal lines
await db.api.save.journal_lines({
  journal_entry_id: entry.id,
  account_id: 1001,  // Rent Expense
  debit_amount: 1000,
  credit_amount: 0
}, userId);

await db.api.save.journal_lines({
  journal_entry_id: entry.id,
  account_id: 2001,  // Cash
  debit_amount: 0,
  credit_amount: 1000
}, userId);

// 3. Post the entry (triggers validation and balance update)
const posted = await db.api.save.journal_entries({
  id: entry.id,
  status: "posted"
}, userId);

// ✅ Graph rules execute:
// 1. validate_journal_entry_balanced(entry.id) → returns true (1000 = 1000)
// 2. validate_period_open(5) → returns true
// 3. update_account_balances_for_entry(entry.id, userId) → updates balances
// 4. Entry is posted successfully
```

### Scenario 2: Attempting to Post Unbalanced Entry

```javascript
// Entry with only debit line (unbalanced)
const entry = await db.api.save.journal_entries({
  description: "Bad entry",
  status: "draft",
  org_id: 1,
  fiscal_period_id: 5
}, userId);

await db.api.save.journal_lines({
  journal_entry_id: entry.id,
  account_id: 1001,
  debit_amount: 1000,
  credit_amount: 0
}, userId);

// Try to post
try {
  await db.api.save.journal_entries({
    id: entry.id,
    status: "posted"
  }, userId);
} catch (error) {
  // ❌ Error: "Cannot post unbalanced journal entry - debits must equal credits"
  // Graph rule validation failed, entry remains draft
}
```

### Scenario 3: Attempting to Modify Posted Entry

```javascript
// Try to modify a posted entry
try {
  await db.api.save.journal_entries({
    id: postedEntry.id,
    description: "Changed description"
  }, userId);
} catch (error) {
  // ❌ Error: "Cannot modify posted journal entry - unpost first"
  // Validation rule with condition "@before.status = 'posted'" prevented modification
}
```

## Condition Syntax

Graph rule conditions support:

### Variables
- `@before.field` - Old value of field
- `@after.field` - New value of field
- `@user_id` - Current user ID
- `@id` - Record ID

### Operators
- `=`, `!=` - Equality
- `AND`, `OR`, `NOT` - Logic
- Comparison operators: `>`, `<`, `>=`, `<=`

### Examples

```sql
-- Check if status changed to posted
"@after.status = 'posted' AND @before.status = 'draft'"

-- Check if posted entry
"@before.status = 'posted'"

-- Check if amount changed
"@after.amount != @before.amount"

-- Check if created by specific user
"@user_id = 1"
```

## Action Types

### 1. `validate` - Validation with Rejection

Calls a boolean function and rejects operation if false.

```jsonb
{
  "type": "validate",
  "function": "validate_journal_entry_balanced",
  "params": {"entry_id": "@id"},
  "error_message": "Custom error message"
}
```

### 2. `execute` - Custom Function Execution

Calls a function without checking return value.

```jsonb
{
  "type": "execute",
  "function": "update_account_balances_for_entry",
  "params": {"entry_id": "@id", "user_id": "@user_id"}
}
```

### 3. `create`, `update`, `delete` - CRUD Operations

Existing graph rule actions still work:

```jsonb
{
  "type": "create",
  "entity": "audit_log",
  "data": {
    "table_name": "journal_entries",
    "record_id": "@id",
    "user_id": "@user_id"
  }
}
```

## Benefits for Accounting

1. **Declarative Rules**: Accounting logic is defined in entity configuration, not scattered in code
2. **Automatic Enforcement**: Rules execute automatically on every operation
3. **Transaction Safety**: Validation failures rollback the entire operation
4. **Real-time Updates**: Balance updates happen immediately within the same transaction
5. **Audit Trail**: All changes logged in dzql.events automatically
6. **Multi-user Safe**: Rules enforce consistency even with concurrent users

## Testing

```javascript
// Test validation
test("Cannot post unbalanced entry", async () => {
  const entry = await db.api.save.journal_entries({
    status: "draft",
    org_id: 1
  }, userId);

  await db.api.save.journal_lines({
    journal_entry_id: entry.id,
    account_id: 1001,
    debit_amount: 1000,
    credit_amount: 0
  }, userId);

  await expect(
    db.api.save.journal_entries({ id: entry.id, status: "posted" }, userId)
  ).rejects.toThrow("Cannot post unbalanced journal entry");
});

// Test balance updates
test("Posting updates account balances", async () => {
  const before = await db.api.get.accounts({ id: 1001 }, userId);

  // Create and post balanced entry
  const entry = await createBalancedEntry();
  await db.api.save.journal_entries({ id: entry.id, status: "posted" }, userId);

  const after = await db.api.get.accounts({ id: 1001 }, userId);
  expect(after.balance - before.balance).toBe(1000);
});
```

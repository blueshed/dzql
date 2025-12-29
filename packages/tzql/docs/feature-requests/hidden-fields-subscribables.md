# Bug: Hidden fields exposed in subscribables

**Status: IMPLEMENTED**

## Issue

Entity hidden fields are not excluded from subscribable queries.

## Example

domain.js:
users: {
  schema: { ... },
  hidden: ["password_hash"],  // Should be excluded from all queries
}

But get_my_profile returns:
{
  "users": {
    "password_hash": "$2a$06$..."  // EXPOSED!
  }
}

## Root Cause

The subscribable SQL generator uses row_to_json(root.*) which returns all columns.

## Fix

When generating subscribable SQL, exclude hidden fields by using explicit column list.

## Impact

Security vulnerability - sensitive data like password hashes exposed to clients.

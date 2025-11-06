# Build Real-Time Double-Entry Bookkeeping System with DZQL

I want to build a real-time accounting system using DZQL that demonstrates:
- Double-entry bookkeeping rules enforced via graph rules
- Multi-user collaboration with real-time balance updates
- Complete audit trail via dzql.events
- Permission-based access control

## Context

This is a demo application in `/packages/dbk` to showcase DZQL's capabilities with a complex, real-world domain. The system should follow DZQL patterns from the venues example.

## Core Entities

Create these entities with appropriate relationships:

1. **organizations** - Companies using the system
2. **accounts** - Chart of accounts (Assets, Liabilities, Equity, Revenue, Expenses)
   - Fields: code (like "1000"), name, account_type, parent_id (hierarchical), balance, org_id
3. **journal_entries** - Accounting transactions
   - Fields: entry_date, description, org_id, status (draft/posted), fiscal_period
4. **journal_lines** - Individual debit/credit lines
   - Fields: entry_id, account_id, debit_amount, credit_amount, description
5. **fiscal_periods** - Accounting periods (months/quarters/years)
   - Fields: org_id, start_date, end_date, status (open/closed)

## Graph Rules Required

### On journal_entry posted:
1. Validate that total debits = total credits (reject if unbalanced)
2. Update account balances for all affected accounts
3. Mark fiscal_period as modified (for report cache invalidation)
4. Create notification for all users in the organization

### On journal_entry deleted:
1. Reverse the account balance updates
2. Only allow if fiscal_period is still open

### On fiscal_period closed:
1. Prevent any journal_entry modifications in that period
2. Create notification for all org users

## Permissions

- **view**: Users can view entries in their organization
- **create**: Users with "bookkeeper" or "accountant" role
- **delete**: Only draft entries, only by creator or admin
- **close_period**: Only users with "accountant" role

Use permission paths like:
```sql
'{"org": ["@org_id->users[org_id=$].user_id"]}'
```

## Custom Functions Needed

1. **`trial_balance(p_user_id INT, p_org_id INT, p_period_id INT)`**
   - Returns all accounts with their balances for a period

2. **`profit_and_loss(p_user_id INT, p_org_id INT, p_start_date DATE, p_end_date DATE)`**
   - Returns revenue and expense totals

3. **`balance_sheet(p_user_id INT, p_org_id INT, p_as_of_date DATE)`**
   - Returns assets, liabilities, equity at a point in time

## Project Structure

Follow DZQL patterns:
```
packages/dbk/
├── database/
│   ├── docker-compose.yml
│   └── init_db/
│       └── 009_dbk_domain.sql      # Entity definitions + registration
├── server/
│   ├── index.js                     # Server entry point
│   └── api.js                       # Custom Bun functions
├── tests/
│   ├── domain.test.js               # Basic CRUD
│   ├── double_entry.test.js         # Validation rules
│   ├── permissions.test.js          # Access control
│   └── reports.test.js              # P&L, Balance Sheet
└── package.json
```

## Technical Requirements

- Use Bun runtime
- PostgreSQL database via Docker
- Follow DZQL conventions from packages/venues example
- Use `dzql.register_entity()` for all entities
- Graph rules should enforce accounting rules (debits = credits)
- Real-time updates via WebSocket broadcasts
- Complete test coverage

## Validation Rules

The system MUST enforce:
1. Debits always equal credits in a journal entry
2. Posted entries cannot be modified (only draft entries)
3. Closed periods cannot have new entries
4. Account balances must reconcile with journal_lines

## Sample Data

Create seed data for testing:
- 1 test organization
- Standard chart of accounts (Assets, Liabilities, Equity, Revenue, Expenses)
- Sample journal entries showing typical transactions
- Multiple fiscal periods (some open, some closed)

## Success Criteria

The demo should showcase:
1. ✅ Creating a journal entry validates debits = credits
2. ✅ Account balances update in real-time for all connected users
3. ✅ Unbalanced entries are rejected with clear error
4. ✅ Reports (P&L, Balance Sheet) calculate correctly
5. ✅ Multi-user: Two users can work simultaneously without conflicts
6. ✅ Audit trail: All changes logged in dzql.events
7. ✅ Permissions: Users can only access their org's data

## Commands

Set up package.json scripts:
- `bun dbk:db` - Start PostgreSQL
- `bun dbk` - Start server
- `bun dbk:test` - Run tests
- `bun dbk:logs` - View PostgreSQL logs

## Reference Implementation

Look at `packages/venues` for patterns:
- How entities are registered
- Graph rules structure
- Permission paths syntax
- Test patterns
- Server setup

Start with the database schema and entity registration, then add graph rules, then custom functions, then tests.

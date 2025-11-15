# Streaks Client API

Real-time habit tracking API using JSON-RPC over WebSocket with automatic authentication.

## Quick Start

```javascript
import { WebSocketManager } from 'dzql/client';

const ws = new WebSocketManager('ws://localhost:3001');
await ws.ready;

// Login
const { token } = await ws.api.login_user({
  email: 'user@example.com',
  password: 'password'
});
// Token auto-stored and sent with all requests
```

## API Pattern

```javascript
await ws.api.{operation}.{entity}(params)
```

**Operations:** `get` | `save` | `delete` | `search` | `lookup`

## Entities

### Streaks

```javascript
{
  id: 1,
  name: "Morning Meditation",
  description: "10 minutes daily",
  total_logs: 5,        // Auto-calculated
  current_streak: 3,    // Auto-calculated  
  longest_streak: 7     // Auto-calculated
}
```

```javascript
// Create (user_id auto-injected)
const streak = await ws.api.save.streaks({ 
  name: "Morning Run",
  description: "5K daily"
});

// Get
const streak = await ws.api.get.streaks({ id: 1 });

// Update
await ws.api.save.streaks({ id: 1, name: "Evening Run" });

// Delete
await ws.api.delete.streaks({ id: 1 });

// Search
const { data, total } = await ws.api.search.streaks({
  filters: { name: { ilike: '%run%' } },
  limit: 20,
  offset: 0
});

// Autocomplete
const options = await ws.api.lookup.streaks({ query: "med" });
// Returns: [{ label: "Morning Meditation", value: 1 }]
```

### Streak Logs

Composite PK: `(streak_id, log_date)` - same date = update (UPSERT)

```javascript
{
  streak_id: 1,
  log_date: "2025-01-14",  // YYYY-MM-DD
  notes: "Felt great!"
}
```

```javascript
// Log today
await ws.api.save.streak_logs({
  streak_id: 1,
  log_date: new Date().toISOString().split('T')[0],
  notes: "Completed!"
});

// Update same day
await ws.api.save.streak_logs({
  streak_id: 1,
  log_date: "2025-01-14",
  notes: "Updated notes"
});

// Delete
await ws.api.delete.streak_logs({
  streak_id: 1,
  log_date: "2025-01-14"
});

// History
const { data } = await ws.api.search.streak_logs({
  filters: { streak_id: { eq: 1 } },
  limit: 30
});
```

### Share Connections

Single-row mutual consent model - one row per connection pair. Both users must request connection to share streaks.

**Row states:**
- `valid_from = NULL` → Pending (one user requested, waiting for reciprocal)
- `valid_from IS NOT NULL` → Active mutual connection
- `valid_to IS NOT NULL` → Closed (historical record)

```javascript
// Request connection (by email)
// Creates pending row: { email_a: you, email_b: friend, valid_from: NULL }
await ws.api.create_share_connection({ 
  target_email: "friend@example.com" 
});

// When friend requests back, the row becomes active (valid_from set)
// Connection becomes mutual - both can now see each other's streaks

// Close connection (either party can close)
// Sets valid_to on the row
await ws.api.close_share_connection({ 
  target_email: "friend@example.com" 
});

// Reopen connection
// Creates new row (preserves temporal history)
await ws.api.create_share_connection({ 
  target_email: "friend@example.com" 
});
```

### Streak Reactions

```javascript
{
  id: 1,
  streak_id: 1,
  reaction_type: "fire"  // or "heart", "clap", etc.
}
```

```javascript
// React (user_id auto-injected)
const reaction = await ws.api.save.streak_reactions({
  streak_id: 1,
  reaction_type: "fire"
});

// Change reaction
await ws.api.save.streak_reactions({
  id: 1,
  reaction_type: "heart"
});

// Remove
await ws.api.delete.streak_reactions({ id: 1 });

// View all
const { data } = await ws.api.search.streak_reactions({
  filters: { streak_id: { eq: 1 } }
});
```

## Search Filters

```javascript
{
  filters: {
    field: { eq: value },           // Equal
    field: { ne: value },           // Not equal
    field: { gt: value },           // Greater than
    field: { gte: value },          // Greater than or equal
    field: { lt: value },           // Less than
    field: { lte: value },          // Less than or equal
    field: { ilike: '%pattern%' },  // Case-insensitive
    field: { like: '%pattern%' }    // Case-sensitive
  },
  limit: 20,
  offset: 0
}
```

## Real-Time Events

```javascript
ws.onBroadcast((method, params) => {
  // method: "streaks:update", "streak_logs:insert", etc.
  // params: { table, op, pk, before, after, user_id, at }
  
  if (method === 'streaks:update') {
    updateUI(params.after);
  }
  
  if (method === 'streak_logs:insert') {
    showNotification(`New log for streak ${params.after.streak_id}!`);
  }
  
  if (method === 'streak_reactions:insert') {
    animateReaction(params.after.streak_id, params.after.reaction_type);
  }
  
  if (method === 'share_connections:insert') {
    const { email_a, email_b, valid_from } = params.after;
    if (valid_from === null) {
      // Pending connection request
      showNotification(`${email_a} wants to connect!`);
    } else {
      // Mutual connection activated!
      showNotification(`You're now connected with ${email_b}!`);
    }
  }
  
  if (method === 'share_connections:update') {
    const { email_a, email_b, valid_from, valid_to } = params.after;
    if (valid_from !== null && valid_to === null) {
      // Connection activated (reciprocal request received)
      showNotification(`Connection with ${email_b} is now mutual!`);
    } else if (valid_to !== null) {
      // Connection closed
      showNotification(`Connection with ${email_b} closed`);
    }
  }
});
```

## Permissions

- **Own streaks:** Full access (view, update, delete)
- **Connected user streaks:** Read-only access via mutual connections
- **Logs:** Only owner can create/update/delete
- **Reactions:** Anyone with access can react
- **Connections:** Either party can close at any time

## Error Handling

```javascript
try {
  await ws.api.get.streaks({ id: 1 });
} catch (error) {
  if (error.message === 'record not found') { }
  if (error.message.includes('Permission denied')) { }
  if (error.message === 'Authentication required') { }
}
```

## Common Patterns

### Daily Check-in

```javascript
const today = new Date().toISOString().split('T')[0];

// Idempotent - creates or updates today's log
await ws.api.save.streak_logs({
  streak_id: streakId,
  log_date: today,
  notes: "Completed!"
});
```

### Dashboard

```javascript
// My streaks
const mine = await ws.api.search.streaks({ limit: 100 });

// Connected users (mutual connections give access to their streaks)
// Query streaks normally - permissions automatically filter to accessible ones
const all = await ws.api.search.streaks({ limit: 100 });
// Returns: my streaks + connected users' streaks
```

### Social Feed

```javascript
ws.onBroadcast((method, params) => {
  const myStreakIds = [1, 2, 3]; // Track these
  
  if (method === 'streak_logs:insert' && 
      myStreakIds.includes(params.after.streak_id)) {
    addToFeed({
      type: 'log',
      user: params.user_id,
      streak: params.after.streak_id,
      date: params.after.log_date
    });
  }
});
```

## Client Wrapper

```javascript
export class StreaksClient {
  constructor(url = 'ws://localhost:3001') {
    this.ws = new WebSocketManager(url);
  }

  async connect() { await this.ws.ready; }
  async login(email, password) { 
    return this.ws.api.login_user({ email, password }); 
  }

  // Streaks
  getStreak(id) { return this.ws.api.get.streaks({ id }); }
  saveStreak(data) { return this.ws.api.save.streaks(data); }
  deleteStreak(id) { return this.ws.api.delete.streaks({ id }); }
  searchStreaks(filters = {}) { 
    return this.ws.api.search.streaks({ filters }); 
  }

  // Logs
  logStreak(streakId, date, notes = '') {
    return this.ws.api.save.streak_logs({ 
      streak_id: streakId, 
      log_date: date, 
      notes 
    });
  }
  getStreakLogs(streakId) {
    return this.ws.api.search.streak_logs({
      filters: { streak_id: { eq: streakId } }
    });
  }

  // Connections
  requestConnection(email) {
    return this.ws.api.create_share_connection({ target_email: email });
  }
  closeConnection(email) {
    return this.ws.api.close_share_connection({ target_email: email });
  }

  // Reactions
  react(streakId, type) {
    return this.ws.api.save.streak_reactions({ 
      streak_id: streakId, 
      reaction_type: type 
    });
  }

  // Events
  onEvent(callback) { this.ws.onBroadcast(callback); }
}
```

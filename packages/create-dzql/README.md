# {{name}}

A real-time database application powered by [DZQL](https://github.com/blueshed/dzql).

## Quick Start

```bash
# Install dependencies
bun install

# Compile domain and start database
bun run db:rebuild

# Start development servers
bun run dev
```

The app will be available at:
- **Client**: http://localhost:5173
- **Server**: http://localhost:3000
- **WebSocket**: ws://localhost:3000/ws

## Project Structure

```
├── domain.ts           # Entity definitions and subscriptions
├── generated/          # Compiled output (after compile)
│   ├── db/migrations/  # SQL migrations
│   ├── runtime/        # Server manifest
│   └── client/         # TypeScript SDK & stores
├── server/             # DZQL server
│   └── index.ts
├── client/             # Vue/Vite frontend
│   └── src/
├── compose.yml         # Docker Compose for PostgreSQL
└── .env                # Environment variables
```

## Development Workflow

### Modify the Domain

Edit `domain.ts` to add entities, permissions, or subscriptions. Then rebuild:

```bash
bun run db:rebuild
```

This compiles the domain and restarts PostgreSQL with a fresh database.

### Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start server and client in watch mode |
| `bun run compile` | Compile domain.ts to generated/ |
| `bun run db:up` | Start PostgreSQL |
| `bun run db:down` | Stop PostgreSQL and remove data |
| `bun run db:rebuild` | Compile + restart database (clean slate) |

## Entity Definition

```typescript
export const entities = {
  posts: {
    schema: {
      id: 'serial PRIMARY KEY',
      title: 'text NOT NULL',
      author_id: 'int REFERENCES users(id)'
    },
    permissions: {
      view: [],                    // Anyone can view
      create: [],                  // Logged-in users can create
      update: ['@author_id'],      // Only author can update
      delete: ['@author_id']       // Only author can delete
    }
  }
};
```

## Subscriptions

Real-time data with automatic updates:

```typescript
import { usePostDetailStore } from '@generated/client/stores/usePostDetailStore';

const store = usePostDetailStore();
const { data } = await store.bind({ post_id: 1 });

// data is reactive - updates automatically when post or comments change
```

## Learn More

- [DZQL Documentation](https://github.com/blueshed/dzql)

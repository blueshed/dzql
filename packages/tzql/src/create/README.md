# {{name}}

A real-time database application powered by [DZQL](https://github.com/blueshed/dzql).

## Quick Start

```bash
# Start PostgreSQL
bun run db:up

# Copy environment file
cp .env.example .env

# Compile domain and generate SQL
bun run compile

# Run migrations
bun run db:migrate

# Start development server
bun run dev
```

## Project Structure

```
├── domain.ts        # Entity definitions and subscriptions
├── server.ts        # Runtime server configuration
├── compose.yml      # Docker Compose for PostgreSQL
├── dist/            # Generated output (after compile)
│   ├── db/          # SQL migrations
│   ├── runtime/     # Server manifest
│   └── client/      # TypeScript SDK & Pinia stores
└── .env             # Environment variables
```

## Domain Definition

Edit `domain.ts` to define your entities:

```typescript
export const entities = {
  posts: {
    schema: {
      id: 'serial PRIMARY KEY',
      title: 'text NOT NULL',
      content: 'text'
    },
    permissions: {
      view: [],
      create: [],
      update: ['@author_id'],
      delete: ['@author_id']
    }
  }
};
```

## API Endpoints

After starting the server:

- **WebSocket**: `ws://localhost:3000/ws`
- **Health**: `GET http://localhost:3000/health`

## Client Usage

```typescript
import { TzqlClient } from './dist/client';

const client = new TzqlClient('ws://localhost:3000/ws');

// Register
await client.api.register_user({ 
  email: 'user@example.com', 
  password: 'secret' 
});

// Login
const { token } = await client.api.login_user({ 
  email: 'user@example.com', 
  password: 'secret' 
});

// CRUD operations
const post = await client.api.save_posts({ 
  title: 'Hello World' 
});

// Real-time subscription
await client.api.subscribe_post_detail(
  { post_id: post.id }, 
  (data) => console.log('Updated:', data)
);
```

## Learn More

- [DZQL Documentation](https://github.com/blueshed/dzql)
- [Graph Rules](https://github.com/blueshed/dzql/docs/guides/graph-rules.md)
- [Subscriptions](https://github.com/blueshed/dzql/docs/guides/subscriptions.md)

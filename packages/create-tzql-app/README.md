# My TZQL App

A real-time database application built with [TZQL](https://github.com/blueshed/dzql).

## Create a New Project

```bash
bun create blueshed/dzql/packages/create-tzql-app my-app
cd my-app
bun install
bun run setup
bun run dev
```

Open http://localhost:3000 to see your app.

The project name (`my-app`) becomes your database name automatically.

## Project Structure

```
├── entities.js      # Domain definition (entities + subscribables)
├── server.ts        # Bun server entry point
├── compose.yml      # Docker Compose for PostgreSQL
├── public/          # Static files
│   └── index.html   # Client application
└── dist/            # Compiled output (generated)
    ├── db/          # SQL migrations
    ├── runtime/     # Manifest for server
    └── client/      # Generated SDK + Pinia stores
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `bun run compile` | Compile entities.js to SQL + SDK |
| `bun run db:up` | Start PostgreSQL container |
| `bun run db:down` | Stop PostgreSQL container |
| `bun run db:rebuild` | Reset database with fresh schema |
| `bun run dev` | Start server with hot reload |
| `bun run start` | Start server in production mode |
| `bun run setup` | Compile + start database (first run) |

## Defining Entities

Edit `entities.js` to define your domain:

```javascript
export const entities = {
  posts: {
    schema: {
      id: "serial PRIMARY KEY",
      title: "text NOT NULL",
      author_id: "int NOT NULL REFERENCES users(id)",
    },
    permissions: {
      view: [],                          // Public read
      create: ["@author_id == @user_id"], // Only create as self
      update: ["@author_id == @user_id"], // Only owner can edit
      delete: ["@author_id == @user_id"],
    },
  },
};
```

## Subscribables (Real-time Documents)

Define nested documents that update in real-time:

```javascript
export const subscribables = {
  post_detail: {
    params: { post_id: "int" },
    root: { entity: "posts", key: "post_id" },
    includes: {
      author: { entity: "users", relation: "author" },
      comments: { entity: "comments", filter: { post_id: "@id" } },
    },
    scopeTables: ["posts", "users", "comments"],
  },
};
```

## WebSocket API

Connect to `ws://localhost:3000/ws` and send JSON-RPC messages:

```javascript
// Call a function
ws.send(JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "create_posts",
  params: { title: "Hello World", author_id: 1 }
}));

// Subscribe to real-time updates
ws.send(JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  method: "subscribe_post_detail",
  params: { post_id: 1 }
}));
```

## Environment Variables

The `.env` file is created automatically from `.env.example`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/my-app
PORT=3000
JWT_SECRET=change-me-in-production
```

## Learn More

- [TZQL Documentation](https://github.com/blueshed/dzql/tree/main/packages/tzql/docs)
- [Entity Definition Guide](https://github.com/blueshed/dzql/tree/main/packages/tzql/docs/README.md)

# DZQL

PostgreSQL-powered framework with automatic CRUD operations, live query subscriptions, and real-time WebSocket synchronization.

## Quick Start

```bash
bun add dzql

export DATABASE_URL="postgresql://user:pass@localhost:5432/mydb"
bunx dzql db:init

bunx dzql compile entities.sql -o init_db/
psql $DATABASE_URL -f init_db/*.sql
```

See **[Quick Start Guide](docs/getting-started/quickstart.md)** for the full 5-minute setup.

## Documentation

- **[Quick Start](docs/getting-started/quickstart.md)** - 5-minute setup
- **[Full Tutorial](docs/getting-started/tutorial.md)** - Complete tutorial with working app
- **[API Reference](docs/reference/api.md)** - Complete API documentation
- **[Subscriptions](docs/getting-started/subscriptions-quick-start.md)** - Real-time denormalized documents
- **[Compiler Guide](docs/compiler/)** - Entity compilation and coding standards
- **[Claude Guide](docs/for-ai/claude-guide.md)** - Development guide for AI assistants

## Quick Example

```javascript
import { WebSocketManager } from 'dzql/client';

const ws = new WebSocketManager();
await ws.connect();

// All 5 operations work automatically
const user = await ws.api.save.users({ name: 'Alice' });
const results = await ws.api.search.users({ filters: { name: 'alice' } });

// Live query subscriptions
const { data, unsubscribe } = await ws.api.subscribe_venue_detail(
  { venue_id: 123 },
  (updated) => console.log('Venue changed!', updated)
);
```

## DZQL Compiler

Transform declarative entity definitions into optimized PostgreSQL stored procedures:

```bash
# Via CLI
dzql compile database/init_db/009_venues_domain.sql -o compiled/

# Programmatically
import { DZQLCompiler } from 'dzql/compiler';

const compiler = new DZQLCompiler();
const result = compiler.compileFromSQL(sqlContent);
```

See **[Compiler Documentation](docs/compiler/)** for complete usage guide, coding standards, and advanced features.

## Testing

```bash
# From repository root - start test database
docker compose up -d

# Initialize test database
bun run test:init

# Run tests
bun test

# Stop database
docker compose down
```

All tests use `bun:test` framework. See **[tests/README.md](../../tests/README.md)** for details.

## License

MIT

## Links

- **GitHub**: https://github.com/blueshed/dzql
- **Issues**: https://github.com/blueshed/dzql/issues
- **npm**: https://www.npmjs.com/package/dzql

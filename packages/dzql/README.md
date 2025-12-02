# DZQL

PostgreSQL-powered framework with automatic CRUD operations, live query subscriptions, and real-time WebSocket synchronization.

## Quick Start (5 minutes)

```bash
# Install
bun add dzql

# Initialize database (~70 lines of SQL)
export DATABASE_URL="postgresql://user:pass@localhost:5432/mydb"
bunx dzql db:init

# Compile your entities
bunx dzql compile entities.sql -o init_db/

# Apply compiled SQL
psql $DATABASE_URL -f init_db/*.sql
```

That's it. You now have a real-time API with automatic CRUD for all your entities.

## Documentation

- **[Quick Start Guide](docs/getting-started/quickstart.md)** - 5-minute setup (recommended)
- **[Full Tutorial](docs/getting-started/tutorial.md)** - Complete tutorial with working todo app
- **[API Reference](docs/reference/api.md)** - Complete API documentation
- **[Live Query Subscriptions](docs/getting-started/subscriptions-quick-start.md)** - Real-time denormalized documents
- **[Compiler Documentation](docs/compiler/)** - Entity compilation guide and coding standards
- **[Claude Guide](docs/for-ai/claude-guide.md)** - Development guide for AI assistants
- **[Venues Example](../venues/)** - Full working application

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

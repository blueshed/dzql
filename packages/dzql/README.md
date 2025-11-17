# DZQL

PostgreSQL-powered framework with automatic CRUD operations, live query subscriptions, and real-time WebSocket synchronization.

## Documentation

- **[Getting Started Guide](docs/GETTING_STARTED.md)** - Complete tutorial with working todo app
- **[API Reference](docs/REFERENCE.md)** - Complete API documentation
- **[Live Query Subscriptions](../../docs/SUBSCRIPTIONS_QUICK_START.md)** - Real-time denormalized documents (NEW in v0.2.0)
- **[Compiler Documentation](docs/compiler/)** - Entity compilation guide and coding standards
- **[Claude Guide](docs/CLAUDE.md)** - Development guide for AI assistants
- **[Venues Example](../venues/)** - Full working application

## Quick Install

```bash
bun add dzql
# or
npm install dzql
```

## Quick Example

```javascript
import { WebSocketManager } from 'dzql/client';

const ws = new WebSocketManager();
await ws.connect();

// All 5 operations work automatically
const user = await ws.api.save.users({ name: 'Alice' });
const results = await ws.api.search.users({ filters: { name: 'alice' } });

// NEW in v0.2.0: Live query subscriptions
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

## License

MIT

## Links

- **GitHub**: https://github.com/blueshed/dzql
- **Issues**: https://github.com/blueshed/dzql/issues
- **npm**: https://www.npmjs.com/package/dzql

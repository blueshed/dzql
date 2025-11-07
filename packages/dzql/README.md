# DZQL

PostgreSQL-powered framework with automatic CRUD operations and real-time WebSocket synchronization.

## Documentation

All documentation is maintained in the repository root:

- **[README.md](../../README.md)** - Project overview and quick start
- **[GETTING_STARTED.md](GETTING_STARTED.md)** - Complete tutorial with working todo app
- **[REFERENCE.md](REFERENCE.md)** - Complete API reference
- **[CLAUDE.md](../../docs/CLAUDE.md)** - Development guide for AI assistants
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
```

## License

MIT

## Links

- **GitHub**: https://github.com/blueshed/dzql
- **Issues**: https://github.com/blueshed/dzql/issues
- **npm**: https://www.npmjs.com/package/dzql

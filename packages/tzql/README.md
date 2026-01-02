# DZQL

Database-first real-time framework with TypeScript support.

## Quick Start

```bash
bun create dzql my-app
cd my-app
bun install
bun run db:rebuild
bun run dev
```

## Documentation

See the [full documentation](./docs/README.md) for:

- [Project Setup Guide](./docs/project-setup.md)
- [AI Assistant Guide](./docs/for_ai.md)

## Package Exports

```typescript
import { createServer } from 'dzql';           // Runtime server
import { ws } from 'dzql/client';              // WebSocket client  
import { compile } from 'dzql/compiler';       // CLI compiler
import { DzqlNamespace } from 'dzql/namespace'; // Direct DB access
```

## License

MIT

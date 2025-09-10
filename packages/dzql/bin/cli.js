#!/usr/bin/env bun

const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case 'create':
    console.log('🚧 Create command coming soon');
    console.log(`Would create project: ${args[0]}`);
    break;
  case 'dev':
    console.log('🚧 Dev command coming soon');
    break;
  case 'db:up':
    console.log('🚧 Database commands coming soon');
    break;
  case '--version':
  case '-v':
    const pkg = await import('../package.json', { assert: { type: 'json' } });
    console.log(pkg.default.version);
    break;
  default:
    console.log(`
DZQL CLI

Usage:
  dzql create <app-name>     Create a new DZQL application
  dzql dev                   Start development server
  dzql db:up                 Start PostgreSQL database
  dzql db:down               Stop PostgreSQL database
  dzql --version             Show version

Examples:
  dzql create my-venue-app
  dzql dev
`);
}

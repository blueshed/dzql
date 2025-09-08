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
ZeroQL CLI

Usage:
  zeroql create <app-name>     Create a new ZeroQL application
  zeroql dev                   Start development server
  zeroql db:up                 Start PostgreSQL database
  zeroql db:down               Stop PostgreSQL database
  zeroql --version             Show version

Examples:
  zeroql create my-venue-app
  zeroql dev
`);
}

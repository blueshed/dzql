# Documentation Reorganization Plan

## Goal
Reorganize documentation with clear separation by audience:
- **Root /docs/** - Contributor/developer documentation
- **Package /packages/dzql/docs/** - User-facing documentation (published to npm)

## File Movements

### Phase 1: Root Directory Changes

#### Create New Files
```
/CHANGELOG.md            # Consolidate release notes
/CONTRIBUTING.md         # Contributor guide
```

#### Reorganize /docs/
```
/docs/
├── development/         # Development workflow
│   ├── TDD_WORKFLOW.md          (MOVE from /docs/)
│   ├── WEBSOCKET_TESTING.md     (MOVE from /docs/)
│   ├── CLAUDE-WEB.md            (MOVE from /docs/)
│   └── TESTING_REPORT.md        (MOVE from /docs/)
│
├── architecture/        # System architecture & design
│   ├── PERMISSIONS.md           (MOVE from /docs/)
│   ├── ROADMAP.md               (MOVE from /docs/)
│   └── CANONICAL-STORES-SUMMARY.md (MOVE from /docs/)
│
└── examples/            # Example implementations
    ├── daisyui.md               (MOVE from /docs/)
    └── three-panels.md          (MOVE from /docs/)
```

#### Files to Remove/Consolidate
```
/docs/CLAUDE.md              → DELETE (duplicate of package version)
/docs/RELEASE_NOTES_v0.2.0.md → CONSOLIDATE into /CHANGELOG.md
/docs/RELEASE_NOTES_v0.2.1.md → CONSOLIDATE into /CHANGELOG.md
```

### Phase 2: Package Documentation Changes

#### Reorganize /packages/dzql/docs/
```
/packages/dzql/docs/
├── README.md                    # Documentation index (NEW)
│
├── getting-started/             # New user tutorials
│   ├── installation.md          (EXTRACT from GETTING_STARTED.md)
│   ├── tutorial.md              (from GETTING_STARTED.md)
│   └── quick-start.md           (from package README)
│
├── guides/                      # Feature guides
│   ├── entities.md              (EXTRACT from REFERENCE.md)
│   ├── permissions.md           (EXTRACT from REFERENCE.md)
│   ├── graph-rules.md           (EXTRACT from REFERENCE.md)
│   ├── subscriptions.md         (CONSOLIDATE subscription docs)
│   ├── client-stores.md         (MOVE from CLIENT-STORES.md)
│   └── testing.md               (NEW - user testing guide)
│
├── reference/                   # API reference
│   ├── api.md                   (from REFERENCE.md - operations)
│   ├── client.md                (from CLIENT-QUICK-START.md)
│   ├── compiler.md              (INDEX to compiler/ subdocs)
│   └── websocket-protocol.md    (EXTRACT from REFERENCE.md)
│
├── compiler/                    # Compiler docs (existing)
│   ├── README.md                (INDEX for compiler docs)
│   ├── quickstart.md            (existing)
│   ├── advanced-filters.md      (existing)
│   └── coding-standards.md      (existing)
│
└── for-ai/                      # AI assistant guides
    └── claude-guide.md          (from CLAUDE.md)
```

#### Files to Remove/Consolidate
```
GETTING_STARTED.md              → SPLIT into getting-started/
REFERENCE.md                    → SPLIT into guides/ and reference/
CLIENT-QUICK-START.md           → MOVE to reference/client.md
CLIENT-STORES.md                → MOVE to guides/client-stores.md
LIVE_QUERY_SUBSCRIPTIONS.md    → MOVE to guides/subscriptions.md
SUBSCRIPTIONS_QUICK_START.md   → MERGE into guides/subscriptions.md
LIVE_QUERY_SUBSCRIPTIONS_STRATEGY.md → ARCHIVE or merge
CLAUDE.md                       → MOVE to for-ai/claude-guide.md
```

## Implementation Steps

### Step 1: Create Directory Structure
- Create `/docs/development/`
- Create `/docs/architecture/`
- Create `/docs/examples/`
- Create `/packages/dzql/docs/getting-started/`
- Create `/packages/dzql/docs/guides/`
- Create `/packages/dzql/docs/reference/`
- Create `/packages/dzql/docs/for-ai/`

### Step 2: Move Contributor Docs
- Move development workflow files to `/docs/development/`
- Move architecture files to `/docs/architecture/`
- Move example files to `/docs/examples/`

### Step 3: Consolidate Release Notes
- Create `/CHANGELOG.md`
- Merge release notes from `/docs/RELEASE_NOTES_*.md`
- Delete old release note files

### Step 4: Create CONTRIBUTING.md
- Extract contribution guidelines
- Link to development docs

### Step 5: Reorganize Package Docs
- Create documentation index
- Split and move user-facing docs
- Update all internal links

### Step 6: Update README Files
- Update root README.md links
- Update package README.md links
- Ensure consistent navigation

### Step 7: Verify
- Check all links work
- Ensure npm package includes correct docs
- Test documentation flow

## Link Update Strategy

After moving files, update these link patterns:

### Root README.md
```markdown
- [Getting Started](packages/dzql/docs/getting-started/tutorial.md)
- [Documentation](packages/dzql/docs/README.md)
- [Contributing](CONTRIBUTING.md)
- [Roadmap](docs/architecture/ROADMAP.md)
```

### Package README.md
```markdown
- [Getting Started](docs/getting-started/tutorial.md)
- [API Reference](docs/reference/api.md)
- [Subscriptions Guide](docs/guides/subscriptions.md)
- [AI Guide](docs/for-ai/claude-guide.md)
```

## Benefits

1. **Clear Audience Separation**
   - Contributors know to look in `/docs/`
   - Users look in package docs
   - AI assistants have dedicated section

2. **Better npm Package**
   - Only user-facing docs published
   - Clearer documentation structure
   - Easier to navigate

3. **Easier Maintenance**
   - No duplicate files
   - Clear ownership of content
   - Logical grouping

4. **Improved Discovery**
   - Index files guide users
   - Related content grouped together
   - Clear progression from beginner to advanced

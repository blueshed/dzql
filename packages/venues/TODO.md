# DZQL Development TODO

## Quick Start Commands

```bash
bun venues:test    # Run the venues test suite
bun venues:db      # Reset the database (clean slate)
bun venues:logs    # View venues application logs
```

## 🎯 Current Priority: Component Recipe Generator

**Status: Meta endpoint complete, need to build UX recipe generator from metadata**

### Component Recipe System TODO
- [ ] **Replace navigation graph with component recipes**
  - Remove current navigationGraph from meta-route.js  
  - Build recipe generator that outputs component specifications
  - Start from user→acts_for→organizations workflow
  - Generate recipes for each path with component + props

- [ ] **Recipe format specification**
  ```json
  {
    "path": "user→acts_for→organisations→venues",
    "component": "MapWithSidebar", 
    "fallback": "TableWithActions",
    "props": {
      "entity": "venues",
      "primaryField": "address", 
      "permissions": {...},
      "actions": [...],
      "navigation": {...}
    }
  }
  ```

- [ ] **Component library design**
  - Generic: TableWithActions, FormModal, DetailView, ListWithFilters
  - Custom: VenueMapManager, AllocationCalendar, ContractorKanban, PackageMarketplace
  - App loads custom component or falls back to generic

- [ ] **Recipe generation algorithm** 
  - Analyze schema for UI hints (temporal→calendar, geo→map)
  - Parse permission paths to determine available actions
  - Build navigation options from relations
  - Detect business workflows from entity graph
  - Output component recipes, not generic navigation

- [ ] **Test recipe generation**
  - Verify recipes generate for key workflows:
    - user→orgs→venues→sites (venue management)
    - packages→allocations→sites (booking flow)
    - contractor_rights workflow
  - Validate component selection logic
  - Test fallback mechanisms

**Next session focus: Implement recipe generator in meta-route.js**

## 📋 Test Coverage Expansion (Lower Priority)

**Status: Core framework is stable (82/82 tests passing), now expanding coverage**

## 📋 Immediate Tasks (Next Sprint)

### Critical Entity Testing
- [ ] **contractor_rights**: Add full CRUD test suite (currently 0% coverage)
  - Basic operations: GET, SAVE, DELETE, LOOKUP, SEARCH
  - Temporal filtering with `valid_from`/`valid_to`
  - Permission delegation scenarios
- [ ] **users**: Add DZQL operations testing (not just auth)
  - Direct CRUD operations via `ws.api.*`
  - User profile management
  - Permission updates
- [ ] **acts_for**: Add direct operation tests
  - Currently only tested via graph rules
  - Temporal relationship management
  - Permission inheritance

### Core Feature Gaps
- [ ] **Temporal Operations**: Add `on_date` parameter testing
  - Test across all temporal entities
  - Historical data queries
  - Edge cases and validation
- [ ] **Error Conditions**: Add comprehensive error testing
  - Malformed inputs
  - Permission denied scenarios
  - Invalid references

## 📋 Short Term Tasks (Next Month)

### Search Operations
- [ ] Add SEARCH tests for 8 remaining entities:
  - sites, products, packages, acts_for, allocations, users, contractor_rights
- [ ] Complex filter combinations
- [ ] Text search across `searchable_fields`
- [ ] Performance with larger datasets

### Lookup Operations  
- [ ] Add LOOKUP tests for 8 remaining entities:
  - venues, sites, products, packages, acts_for, allocations, users, contractor_rights
- [ ] Label field resolution testing
- [ ] Filter functionality
- [ ] Error handling

### Advanced Permissions
- [ ] Multi-hop permission path testing
- [ ] Temporal permission filtering
- [ ] Permission inheritance chains
- [ ] Edge cases (expired relationships)

## 📋 Medium Term Tasks (Next Quarter)

### Advanced Features
- [ ] **Foreign Key Dereferencing**:
  - Complex nested dereferencing
  - Collection includes performance
  - Circular reference handling
- [ ] **Advanced Graph Rules**:
  - Multi-action rules
  - Conditional logic
  - Error handling in rules
- [ ] **Soft Delete**: Implement and test (currently unused)

### Performance & Scale
- [ ] Concurrent operation testing
- [ ] Stress testing with large datasets
- [ ] Complex business scenario tests
- [ ] Performance benchmarking

## 📋 Long Term Tasks (Ongoing)

### Testing Infrastructure
- [ ] Automated test coverage reporting
- [ ] Transaction-based testing with rollback
- [ ] Database seeding for consistent test data
- [ ] PostgreSQL function coverage tracking

### Integration & Documentation
- [ ] End-to-end user journey testing
- [ ] API documentation validation tests
- [ ] Integration tests with external systems
- [ ] Performance monitoring setup

## 🚨 Known Issues & Technical Debt

### Test Infrastructure
- [ ] **Test Cleanup**: Currently requires full DB reset between runs
  - Implement proper per-test cleanup
  - Add consistent test data prefixes
  - Consider transaction rollback approach

### Coverage Gaps by Entity

**Zero Coverage (1/9 entities)**
- contractor_rights: Complete entity testing needed

**Partial Coverage (3/9 entities)**  
- users: Only auth tested, need DZQL operations
- acts_for: Only graph rules, need direct operations
- allocations: Only basic SAVE, need full suite

**Feature Gaps Across All Entities**
- Temporal operations: 0% coverage
- Advanced search: 22% coverage  
- Lookup operations: 11% coverage
- Complex permissions: Basic only
- Error conditions: Minimal

## 🎯 Success Targets

### Coverage Goals
- **Entity Coverage**: 56% → 90% (8/9 entities fully tested)
- **Operation Coverage**: 60% → 85% (4/5 operations per entity)
- **Advanced Features**: 30% → 70% (temporal, permissions, graph rules)
- **Error Scenarios**: 10% → 60% (comprehensive error testing)

### Quality Goals
- Maintain 100% test reliability
- Achieve <3 second full test suite runtime
- Zero test pollution between runs
- Comprehensive edge case coverage

## 📊 Current Entity Test Status

| Entity | GET | SAVE | DELETE | LOOKUP | SEARCH | Priority |
|--------|-----|------|--------|---------|--------|----------|
| contractor_rights | ❌ | ❌ | ❌ | ❌ | ❌ | **HIGH** |
| users | ❌ | ❌ | ❌ | ❌ | ❌ | **HIGH** |
| acts_for | ❌ | ❌* | ❌ | ❌ | ❌ | **HIGH** |
| venues | ✅ | ✅ | ✅ | ❌ | ✅ | Medium |
| sites | ❌ | ✅ | ✅ | ❌ | ❌ | Medium |
| products | ❌ | ✅ | ✅ | ❌ | ❌ | Medium |
| packages | ✅ | ✅ | ❌ | ❌ | ❌ | Medium |
| allocations | ❌ | ✅ | ❌ | ❌ | ❌ | Low |
| organisations | ✅ | ✅ | ✅ | ✅ | ❌ | Low |

*Via graph rules only

## 🔄 Development Workflow

1. **Pick a task** from the current priority section
2. **Reset database**: `bun venues:db && sleep 5`
3. **Run tests**: `bun venues:test`
4. **Check logs**: `bun venues:logs` (if needed)
5. **Commit progress** and update this TODO

## 📝 Notes

- Framework core is stable and production-ready
- Focus is on expanding test coverage, not fixing bugs
- All basic CRUD operations work correctly
- Real-time events, permissions, and graph rules are functional
- Priority is breadth of testing, not depth of new features
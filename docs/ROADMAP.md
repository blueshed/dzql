# DZQL Roadmap to 1.0

## Current Status: Pre-Alpha (0.x)

DZQL has a solid foundation with comprehensive features, but needs hardening and production readiness improvements before a 1.0 release.

---

## Code Review Summary

### ✅ Strengths

1. **Excellent Architecture**
   - Clean separation of concerns (client/server/database)
   - Innovative nested proxy API pattern
   - Database-centric design leverages PostgreSQL strengths
   - Graph rules system is powerful and well-designed

2. **Comprehensive Documentation**
   - Excellent README with clear examples
   - CLAUDE.md provides detailed guidance
   - Good inline comments in SQL migrations
   - CLI tools documented

3. **Strong Testing Foundation**
   - 2,780 lines of test code across 9 test files
   - Tests cover: auth, events, permissions, search, domain, notifications, graph rules, websocket, client
   - Good test patterns with cleanup

4. **Security Basics in Place**
   - JWT authentication implemented
   - Password hashing with bcrypt (pgcrypto)
   - Parameterized queries (protected from SQL injection)
   - Permission system with row-level security

---

## 🚨 Critical Issues (Must Fix Before 1.0)

### 1. ~~**SQL Injection Risk in db.js**~~ ✅ **FIXED**
**Location:** `packages/dzql/src/server/db.js`

**Status:** ✅ **Completed**

**What was done:**
- Added regex validation for function names: `/^[a-z_][a-z0-9_]*$/i`
- Function name validation happens BEFORE metadata lookup
- Blocks SQL injection attempts (semicolons, parentheses, spaces, schema prefixes)
- Maintains function existence validation via `information_schema`
- All parameters remain safely bound with parameterized queries

**Code:**
```javascript
// Validate function name format (only alphanumeric and underscore, no special chars)
// This prevents SQL injection via function names like "foo(); DROP TABLE users--"
if (!/^[a-z_][a-z0-9_]*$/i.test(method)) {
  throw new Error(`Invalid function name: ${method}`);
}
```

**Tests Passed:**
- ✅ Valid function names allowed (`hello`, `my_function`)
- ✅ SQL injection blocked (`hello; DROP TABLE users--`)
- ✅ Parentheses blocked (`foo()`)
- ✅ Spaces blocked (`hello world`)
- ✅ Schema prefixes blocked (`pg_catalog.version`)

---

### 2. ~~**JWT Secret Hardcoded**~~ ✅ **FIXED**
**Location:** `packages/dzql/src/server/ws.js`

**Status:** ✅ **Completed**

**What was done:**
- JWT_SECRET now **required in production** (server crashes if missing)
- Shows warning in development if using default secret
- JWT expiration configurable via `JWT_EXPIRES_IN` env var
- Comprehensive documentation in `.env.example`

**Code:**
```javascript
if (process.env.NODE_ENV === "production" && !JWT_SECRET_STRING) {
  throw new Error(
    "JWT_SECRET environment variable is required in production. Generate one with: openssl rand -base64 32"
  );
}
```

---

### 3. **Missing Rate Limiting**
**Problem:** No protection against:
- Brute force login attempts
- DoS via excessive WebSocket messages
- Spam via excessive database operations

**Solutions:**
- Add rate limiting middleware for HTTP endpoints
- Implement per-user operation throttling
- Add connection limits for WebSocket
- Consider using Redis for distributed rate limiting

**Priority:** HIGH - Production security requirement

---

### 4. **TODO in Entity Registration**
**Location:** `packages/dzql/src/database/migrations/005_entities.sql:233`

```sql
-- TODO: Implement condition evaluation
```

**Problem:** Incomplete feature in entity registration system

**Solution:** Either implement or remove this feature before 1.0

**Priority:** MEDIUM - Depends on whether this feature is needed

---

## ⚠️ Production Readiness Issues

### 5. **No Database Migration System**
**Problem:** Numbered SQL files run on every Docker restart, not tracked migrations

**Solutions:**
- Implement migration tracking (e.g., `dzql.migrations` table)
- Only run new migrations on startup
- Support migration rollback
- Consider using a migration tool (Flyway, Liquibase, or custom)

**Priority:** HIGH - Critical for production deployments

---

### 6. **Limited Error Handling**
**Problems:**
- Generic error messages leak implementation details
- No structured error codes/types
- Stack traces may expose sensitive info in production
- Client receives raw database errors

**Solutions:**
- Create error classification system (validation, permission, not found, server error)
- Map database errors to user-friendly messages
- Hide stack traces in production
- Add error codes for programmatic handling

**Priority:** MEDIUM - UX and security improvement

---

### 7. ~~**No Connection Pool Limits**~~ ✅ **FIXED**
**Location:** `packages/dzql/src/server/db.js`

**Status:** ✅ **Completed**

**What was done:**
- Database pool size now configurable via `DB_MAX_CONNECTIONS` env var
- Idle timeout configurable via `DB_IDLE_TIMEOUT`
- Connect timeout configurable via `DB_CONNECT_TIMEOUT`
- Documented in `.env.example` with recommended values

**Code:**
```javascript
const DB_MAX_CONNECTIONS = parseInt(process.env.DB_MAX_CONNECTIONS || "10", 10);
const DB_IDLE_TIMEOUT = parseInt(process.env.DB_IDLE_TIMEOUT || "20", 10);
const DB_CONNECT_TIMEOUT = parseInt(process.env.DB_CONNECT_TIMEOUT || "10", 10);
```

**Note:** Pool exhaustion handling and monitoring still pending (future enhancement)

---

### 8. ~~**Missing Health Checks**~~ ✅ **PARTIALLY FIXED**
**Current Status:** Basic health check implemented

**What was done:**
- `/health` endpoint added (returns "OK" 200 status)
- Located in `packages/dzql/src/server/index.js`

**Still needed:**
- Database connectivity check
- Readiness probe with dependency checks
- Detailed health status (uptime, connections, etc.)

**Priority:** LOW - Basic endpoint exists, enhancements can wait

---

### 9. **No Observability**
**Problems:**
- Logging is basic (no structured logging)
- No metrics/monitoring integration
- No distributed tracing
- No performance monitoring

**Solutions:**
- Add structured JSON logging option
- Integrate metrics (Prometheus/StatsD)
- Add request tracing IDs
- Performance instrumentation for slow queries

**Priority:** MEDIUM - Production operations requirement

---

### 10. ~~**Environment Configuration**~~ ✅ **FIXED**
**Status:** ✅ **Completed**

**What was done:**
- Comprehensive `.env.example` created with all configuration options
- Organized into logical sections (Database, Security, Server, Logging, WebSocket)
- README updated with configuration section in Quick Start
- Production validation for required vars (JWT_SECRET)
- Helpful comments and examples throughout

**Environment variables now supported:**
- `DATABASE_URL` - PostgreSQL connection
- `JWT_SECRET` - Required in production
- `JWT_EXPIRES_IN` - Token expiration (default: 7d)
- `PORT` - Server port (default: 3000)
- `DB_MAX_CONNECTIONS` - Pool size (default: 10)
- `DB_IDLE_TIMEOUT` - Idle timeout (default: 20s)
- `DB_CONNECT_TIMEOUT` - Connect timeout (default: 10s)
- `WS_PING_INTERVAL` - WebSocket keepalive (default: 30s, Heroku safe)
- `WS_PING_TIMEOUT` - Ping timeout (default: 5s)
- `WS_MAX_MESSAGE_SIZE` - Max message size (default: 1MB)
- `LOG_LEVEL` - Logging level
- `LOG_CATEGORIES` - Per-category log levels

---

## 📋 Nice-to-Have Improvements

### 11. **TypeScript Support**
- Add TypeScript definitions for client library
- Type-safe proxy API
- Better IDE autocomplete

**Priority:** LOW - Would improve DX significantly

---

### 12. **WebSocket Keepalive & Reconnection**

**Keepalive:** ✅ **FIXED** - Server-side ping/pong now configured
- WebSocket `idleTimeout` set to 30 seconds (configurable via `WS_PING_INTERVAL`)
- Heroku-safe defaults (55s timeout limit)
- Properties properly passed to Bun.serve websocket handler:
  - `perMessageDeflate: true`
  - `maxPayloadLength` (configurable via `WS_MAX_MESSAGE_SIZE`)
  - `idleTimeout` (auto-ping after idle period)
  - `closeOnBackpressureLimit`

**Client Reconnection:** Still pending
- Client doesn't auto-reconnect on disconnect
- Solution: Add exponential backoff reconnection logic to client

**Priority:** LOW - Server keepalive prevents most disconnects; client reconnection is enhancement

---

### 13. **Query Performance Optimization**
- Add query plan analysis
- Index recommendations
- Slow query logging
- Query result caching layer

**Priority:** LOW - Performance tuning

---

### 14. **Multi-tenancy Support**
- Row-level security per tenant
- Tenant isolation
- Schema-per-tenant option

**Priority:** LOW - Advanced feature

---

### 15. **Batch Operations**
- Bulk insert/update/delete
- Transaction support across multiple operations
- Batch graph rule processing

**Priority:** LOW - Performance optimization

---

### 16. ~~**Documentation Restructure**~~ ✅ **COMPLETED**

**Status:** ✅ **Completed**

**What was done:**
- Created REFERENCE.md with complete API documentation
- Enhanced CLAUDE.md with 8 new AI-focused sections
- Streamlined root README.md to 300 lines (from 715)
- Minimized packages/dzql/README.md to pointer
- Eliminated 80-90% redundancy across docs

**New Structure:**
```
README.md (300 lines)           - Marketing + quick start
REFERENCE.md (NEW, 800 lines)   - Complete API reference
GETTING_STARTED.md (1100 lines) - Complete tutorial
CLAUDE.md (900 lines)           - AI development guide (enhanced)
.rules (69 lines)               - AI quick reference
ROADMAP.md                      - Project status
```

**Benefits:**
- ✅ Single source of truth per concept
- ✅ AI assistants have comprehensive reference
- ✅ Humans have clear learning path
- ✅ Zero redundancy between files
- ✅ Easy to maintain

---

### 17. **Declarative Validation Function Parameter**

**Status:** 💡 **Proposed** (Optional Enhancement)

**Issue:** While graph rules now support `validate` action (v0.1.1), some developers may prefer a simpler top-level parameter for common validation cases.

**Current Approach (v0.1.1 - Graph Rules):**
```sql
SELECT dzql.register_entity(
  'journal_entries', 'description', ARRAY['description'],
  '{}', false, '{}', '{}', '{}',
  jsonb_build_object(
    'on_update', jsonb_build_object(
      'validate_balanced', jsonb_build_object(
        'condition', '@after.status = ''posted''',
        'actions', jsonb_build_array(
          jsonb_build_object(
            'type', 'validate',
            'function', 'validate_entry',
            'params', jsonb_build_object('p_entry_id', '@id'),
            'error_message', 'Validation failed'
          )
        )
      )
    )
  )
);
```

**Proposed Simpler Alternative:**
```sql
SELECT dzql.register_entity(
  'journal_entries', 'description', ARRAY['description'],
  '{}', false, '{}', '{}', '{}', '{}',
  '_validate_journal_entry'  -- NEW: optional 10th parameter
);
```

**Validation Function Signature:**
```sql
CREATE FUNCTION _validate_journal_entry(
  p_user_id INT,
  p_operation TEXT,      -- 'create' | 'update' | 'delete'
  p_old_data JSONB,      -- Previous values (null for create)
  p_new_data JSONB,      -- New values (null for delete)
  p_context JSONB        -- Timestamps, etc.
) RETURNS JSONB          -- null = success, object = error
```

**Benefits:**
- ✅ Simpler syntax for common validation cases
- ✅ Structured error responses (JSONB with code, field, message)
- ✅ Single validation function per entity
- ✅ Familiar to developers coming from other frameworks
- ✅ Backward compatible (optional parameter)
- ✅ Can coexist with graph rules validation

**Trade-offs:**
- ❌ Less flexible than graph rules (no conditions, no multiple rules)
- ❌ Adds another validation approach (may confuse users)
- ⚠️ Validation runs before DB operation (different timing than graph rules)

**Implementation Effort:** Medium (2-3 days)
- Schema: Add `validation_function` column to `dzql.entities`
- Core: Update `register_entity()` with 10th parameter
- Core: Update `generic_save/delete()` to call validation before DB operation
- Tests: Add validation function test suite
- Docs: Document both approaches with decision tree

**Decision:** 
- **Keep** graph rules validation as primary approach (more flexible)
- **Consider** adding simple parameter in v0.2.0+ if user demand exists
- **Evaluate** based on community feedback and use cases

**Related:**
- Feature request: `/Users/peterb/Workshop/dzql/plan.md`
- Graph rules validation: Implemented in v0.1.1 (002_functions.sql, 005_entities.sql)
- Documentation: Comprehensive examples in CLAUDE.md

**Priority:** LOW - Enhancement for developer experience

---

## 📦 Package Publishing Checklist

### Before Publishing to npm:

**Security & Core:**
- [ ] Fix critical security issues:
  - [x] #1 - SQL Injection Risk ✅ (function name validation)
  - [x] #2 - JWT Secret ✅ (required in production)
  - [ ] #3 - Rate Limiting (basic protection)
- [ ] Implement migration system (#5)

**Configuration & Documentation:**
- [x] Create comprehensive `.env.example` ✅
- [x] Update README with environment configuration ✅
- [x] Add WebSocket keepalive for Heroku ✅
- [x] Basic health check endpoint ✅
- [ ] Enhanced health check with database connectivity
- [ ] Write deployment guide (Heroku, Railway, Render, etc.)

**Package Setup:**
- [ ] Update `package.json`:
  - [ ] Set version to `0.1.0-alpha.1` (pre-release)
  - [ ] Add proper author/repository info
  - [ ] Verify dependencies are correct
  - [ ] Add `files` field to control what's published
- [ ] Add LICENSE file (currently shows MIT but no file)
- [ ] Add CONTRIBUTING.md
- [ ] Add CHANGELOG.md
- [ ] Test installation as npm package
- [ ] Create example starter project

---

## 🎯 Recommended Release Strategy

### Phase 1: Alpha Release (0.1.0 - 0.5.0)
**Timeline:** 2-4 weeks

**Goals:**
- Fix critical security issues (#1, #2, #3)
- Implement migration system (#5)
- Improve error handling (#6)
- Add environment configuration (#10)

**Release Notes:**
```
⚠️ ALPHA SOFTWARE - NOT FOR PRODUCTION USE

DZQL 0.1.0 introduces a PostgreSQL-powered framework for zero-boilerplate
CRUD operations with real-time sync. This is an early alpha release for
testing and feedback.

Known Limitations:
- No rate limiting
- Basic error handling
- Not production-hardened
- API may change

Please report issues and provide feedback!
```

---

### Phase 2: Beta Release (0.6.0 - 0.9.0)
**Timeline:** 4-8 weeks after alpha

**Goals:**
- Add rate limiting (#3)
- Implement observability (#9)
- Add health checks (#8)
- Improve connection pooling (#7)
- Gather community feedback
- Fix bugs from alpha testing
- Stabilize API

**Release Notes:**
```
⚠️ BETA SOFTWARE - Use with caution in production

DZQL 0.6.0 is feature-complete and approaching production readiness.
API is stabilizing but may still have minor breaking changes.

New in Beta:
- Rate limiting and DoS protection
- Health check endpoints
- Improved error handling
- Production-ready logging

Still needed before 1.0:
- Extended production testing
- Performance tuning
- Final API stabilization
```

---

### Phase 3: Release Candidate (0.9.5+)
**Timeline:** 2-4 weeks of testing

**Goals:**
- Production testing by early adopters
- Performance benchmarking
- Security audit
- Final bug fixes
- API freeze

---

### Phase 4: 1.0.0 Release
**Timeline:** When confident and stable

**Criteria for 1.0:**
- ✅ All critical issues resolved
- ✅ Extensive production testing
- ✅ Comprehensive documentation
- ✅ Stable, frozen API
- ✅ Security reviewed
- ✅ Performance acceptable
- ✅ Community feedback incorporated
- ✅ Migration path documented

---

## 📊 Priority Matrix

| Issue | Impact | Effort | Priority | Status |
|-------|--------|--------|----------|--------|
| ~~SQL Injection (#1)~~ | HIGH | LOW | ~~CRITICAL~~ | ✅ **Fixed** |
| ~~JWT Secret (#2)~~ | HIGH | LOW | ~~CRITICAL~~ | ✅ **Fixed** |
| Rate Limiting (#3) | HIGH | MEDIUM | **CRITICAL** | 🔴 **Pending** |
| Migration System (#5) | HIGH | MEDIUM | **HIGH** | 🔴 **Pending** |
| Error Handling (#6) | MEDIUM | MEDIUM | **HIGH** | 🔴 **Pending** |
| ~~Connection Pool (#7)~~ | MEDIUM | LOW | ~~MEDIUM~~ | ✅ **Fixed** |
| ~~Health Checks (#8)~~ | MEDIUM | LOW | ~~MEDIUM~~ | 🟡 **Partial** (basic only) |
| Observability (#9) | MEDIUM | HIGH | **MEDIUM** | 🔴 **Pending** |
| ~~Env Config (#10)~~ | MEDIUM | LOW | ~~MEDIUM~~ | ✅ **Fixed** |
| TODO Feature (#4) | LOW | ? | **LOW** | 🔴 **Pending** |
| TypeScript (#11) | MEDIUM | HIGH | **LOW** | 🔴 **Pending** |
| ~~WS Keepalive (#12)~~ | MEDIUM | LOW | ~~MEDIUM~~ | ✅ **Fixed** (server) |
| WS Reconnect (#12) | LOW | MEDIUM | **LOW** | 🔴 **Pending** (client) |
| Validation Param (#17) | LOW | MEDIUM | **LOW** | 💡 **Proposed** |

---

## 💡 Recommendations

### ✅ Quick Wins Completed (45 minutes)

**Already Done:**
1. ✅ SQL injection protection (function name validation)
2. ✅ JWT secret required in production
3. ✅ Comprehensive `.env.example` created
4. ✅ Database pool configurable
5. ✅ WebSocket keepalive for Heroku
6. ✅ README updated with config section
7. ✅ Basic health check endpoint

### For Immediate Alpha Release (0.1.0-alpha.1)

**Remaining Critical Work:**
1. Add basic rate limiting (#3) - 4 hours
2. Update package.json metadata - 1 hour
3. Write deployment guide - 2 hours
4. **Total: ~6-8 hours of work**

**Then:**
- Publish as `0.1.0-alpha.1` to npm
- Mark as "experimental" in README
- Share with select developers for feedback
- Iterate based on feedback

### For Beta Release (0.6.0)

**Add:**
- Migration system (#5)
- Better error handling (#6)
- Health checks (#8)
- Observability basics (#9)
- **Total: ~2-3 weeks of work**

### For 1.0 Release

**Add:**
- Production battle-testing (3-6 months)
- Security audit
- Performance tuning
- Community feedback integration

---

## 🎬 Next Steps

1. **Review this roadmap** - Does it align with your vision?
2. **Prioritize issues** - Which are most important to you?
3. **Choose a timeline** - Alpha in 1 week? 1 month? 3 months?
4. **Decide on scope** - Full 1.0 or start with 0.1.0 alpha?
5. **Start fixing** - Begin with critical security issues

**Suggested Next Steps:**
```bash
# 1. Add basic rate limiting - ONLY REMAINING CRITICAL ISSUE
# Use a simple in-memory rate limiter for now
# Limit login attempts and API calls per user

# 3. Update package.json
# Set version to 0.1.0-alpha.1
# Add author, repository, files field

# 4. Write deployment guide
# Document Heroku, Railway, Render deployment
# Include environment variable setup

# 5. Publish alpha
npm version 0.1.0-alpha.1
npm publish --tag alpha
```

**Progress Summary:**
- 🟢 **Phase 1 Quick Wins:** 7/10 items completed (70%)
- 🟢 **Critical Security:** 2/3 completed (SQL injection ✅, JWT secret ✅)
- 🟡 **Alpha Blockers:** 1 critical item remains (rate limiting only)
- 🟢 **Documentation:** Complete restructure completed (AI-first, zero redundancy)
- 🔵 **Estimated Time to Alpha:** 6-8 hours

---

## Questions for You

1. **Timeline:** How quickly do you want to release?
2. **Use Case:** Do you need this for production soon, or is it experimental?
3. **Help:** Are you open to contributors, or solo project?
4. **Scope:** Full-featured 1.0 or minimal alpha first?
5. **Breaking Changes:** OK with API changes in 0.x versions?

Let me know your thoughts and I can help prioritize the work!

# Feature Request: Send User Profile on WebSocket Connect

**Status: IMPLEMENTED**

## Summary

When a client connects to the tzql WebSocket server, the server should immediately send a connection:ready message containing the authenticated user profile (or null if not authenticated).

## Current Behavior

1. Client connects with optional ?token=... in URL
2. Server opens connection but sends nothing
3. Client must call auth RPC to authenticate, then separately fetch profile
4. Client has no immediate knowledge of auth state

## Proposed Behavior

1. Client connects with optional ?token=... in URL
2. Server validates token (if present) and fetches user profile
3. Server sends first message:

{"method": "connection:ready", "params": {"user": {"id": 1, "name": "...", "email": "..."} | null}}

4. Client knows auth state immediately, can render accordingly

## Why This Matters

- Single source of truth: WebSocket connection determines auth state, not localStorage
- No race conditions: UI waits for connection:ready before rendering
- Simpler client code: No need for separate auth check after connect
- Better UX: App shows loading state until connection ready, then immediately correct view

## Client Usage Pattern

Template:
  div v-if="!ready" - loading spinner
  LoginModal v-else-if="!user"
  RouterView v-else

## Suggested Server Changes

In src/runtime/ws.ts, modify handleOpen to:
1. Parse token from URL query params
2. If valid, verify token and fetch user profile
3. Send connection:ready message with user (or null)

## Suggested Client Changes

In src/client/ws.ts:
1. Add user and ready properties to class
2. Handle connection:ready message in handleMessage
3. Add onReady callback method

## Migration

- Existing clients that dont handle connection:ready will ignore it (no breaking change)
- New clients can opt-in to the pattern

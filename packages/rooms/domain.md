# Multi-Agent Rooms Plan

## Goals
- Coordinate PeterB, Codex, Claude, and Gemini in a shared workspace.
- Provide infrastructure for cross-agent messaging with human-in-the-loop control.
- Document responsibilities for each participant and next actions.

## Architecture Overview
1. **Bun Hub**
   - Launches each model console as a subprocess (Claude CLI, Gemini CLI, Codex CLI).
   - Exposes a WebSocket endpoint plus static UI to visualize streams.
   - Maintains routing logic so PeterB decides which outputs get forwarded.
2. **Web UI**
   - Displays individual panes for Claude, Gemini, and Codex logs.
   - Offers controls to forward selected text between agents or inject PeterB prompts.
   - Persists transcript snapshots for auditing.
3. **Room Protocol**
   - Messages tagged with `{source, target, body, timestamp}` JSON.
   - Default routing: agent output → PeterB inbox; forwarding requires explicit action.
   - Optional automation hooks (e.g., “send latest to Gemini”) managed via UI buttons.

## Workstreams
### Codex
- Draft Bun server skeleton (`rooms/server.js`) with subprocess management and WebSocket broadcast.
- Define message schema and routing states.
- Coordinate with PeterB on CLI invocation commands for Claude/Gemini.

### Claude
- Flesh out front-end layout (HTML/CSS/JS) for multi-pane console view.
- Implement WebSocket client that subscribes to streams and provides forwarding controls.
- Document UX guidelines for safe forwarding (prevent loops, highlight sender).

### Gemini
- Prototype protocol helpers: message metadata, persistence format, possible automation rules.
- Explore instrumentation hooks (logging, metrics) for the hub.

### PeterB
- Provide CLI entrypoints/env vars for each model console.
- Decide hosting/deployment approach (local Bun dev server vs container).
- Own overall coordination, merging contributions across agents.

## Next Steps
1. PeterB shares exact commands to start Claude and Gemini sessions.
2. Codex scaffolds Bun hub + WebSocket server, commits initial code.
3. Claude builds UI assets and integrates with server endpoints.
4. Gemini designs protocol spec and persistence format.
5. Iterate in the room: test round-trip messaging, refine UX, add automation.

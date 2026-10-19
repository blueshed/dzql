#!/bin/bash
# SessionStart hook: provision the Claude Code web sandbox (Bun, `bun install`, a headless Chromium
# for the browser tests). One script, paintbrush's, which every new app ships with: here it runs at
# the monorepo's root, reading the root package.json's floor. Change it there.
exec bash "$(dirname "$0")/../../packages/paintbrush/.claude/hooks/session-start.sh"

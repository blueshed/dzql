#!/bin/bash
# SessionStart hook: provision the Claude Code web sandbox (Bun, `bun install`, a headless Chromium
# for the browser tests). One script, paintbrush's (create-blueshed's template), which every new app
# ships with: here it runs at the monorepo's root, reading the root package.json's floor. Change it there.
exec bash "$(dirname "$0")/../../packages/create-blueshed/template/.claude/hooks/session-start.sh"

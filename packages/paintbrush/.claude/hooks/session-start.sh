#!/bin/bash
# SessionStart hook: provision the Claude Code web sandbox so `bun test`, browser
# tests included, runs there.
#
# WHY: the web sandbox's Bun is OLDER than this app needs (Bun.WebView wants 1.4), and the
# sandbox has NO BROWSER, and the hosts browsers are downloaded from are blocked. npm and
# GitHub are reachable. So, when its Bun is older than engines.bun, this installs Bun from npm, and a headless Chromium
# from an npm package, and points BUN_CHROME_PATH at it. If browser tests fail in the sandbox,
# run it by hand: CLAUDE_CODE_REMOTE=true CLAUDE_PROJECT_DIR=$PWD CLAUDE_ENV_FILE=/dev/null bash .claude/hooks/session-start.sh
#
# Copied from railroad's hook of the same name, which is where the reasons below were found
# out; change them there first. Web sandbox only: locally you already have Bun and a
# browser, so it exits at once. Runs synchronously, so Bun, the dependencies and the
# browser are ready before the agent loop starts. Idempotent.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# 1. Bun. The sandbox's base image has shipped an older Bun than this app needs
#    (Bun.WebView and the `{ dir }` static routes want 1.4). The floor is the one
#    package.json says, so it is written once. npm's registry is reachable.
floor="$(node -p "require('./package.json').engines.bun.replace(/[^0-9.]/g, '')")"
need_bun=0
if ! command -v bun >/dev/null 2>&1; then
  need_bun=1
elif [ "$(printf '%s\n%s\n' "$(bun --version)" "$floor" | sort -V | head -n1)" != "$floor" ]; then
  need_bun=1
fi
[ "$need_bun" = "1" ] && npm install -g bun@latest

# 2. Dependencies (`install`, not `ci`, so the container's cache is reused).
bun install

# 3. A headless Chromium for Bun.WebView. On Linux it speaks CDP to a Chrome or
#    Chromium found through $BUN_CHROME_PATH. The sandbox has no browser, apt's
#    chromium is a snap stub, and the browser download hosts (cdn.playwright.dev,
#    googlechromelabs.github.io, dl.google.com, storage.googleapis.com) are blocked.
#    npm and GitHub are not, so a real headless build is taken out of the
#    @sparticuz/chromium tarball, which carries the binary inside it.
DEST=/opt/chromium
SHIM="$DEST/chrome-shim.sh"
if [ ! -x "$DEST/chromium" ]; then
  # Two preinstalled PPAs (deadsnakes, ondrej/php) answer 403 and abort `apt update`.
  for f in /etc/apt/sources.list.d/deadsnakes-ubuntu-ppa-*.sources \
           /etc/apt/sources.list.d/ondrej-ubuntu-php-*.sources; do
    [ -f "$f" ] && mv "$f" "$f.disabled" || true
  done

  # Chromium's system libraries (C, fonts, X): apt only, no download host.
  npx --yes playwright@latest install-deps chromium

  # The bundled build, from npm.
  TMP="$(mktemp -d)"
  ( cd "$TMP" && npm pack @sparticuz/chromium >/dev/null && tar xzf sparticuz-chromium-*.tgz )
  mkdir -p "$DEST"
  node -e "const fs=require('fs'),z=require('zlib');fs.writeFileSync('$DEST/chromium',z.brotliDecompressSync(fs.readFileSync('$TMP/package/bin/chromium.br')))"
  chmod +x "$DEST/chromium"
  # Software GL (swiftshader) libraries, found relative to argv[0].
  node -e "const fs=require('fs'),z=require('zlib');fs.writeFileSync('$TMP/swiftshader.tar',z.brotliDecompressSync(fs.readFileSync('$TMP/package/bin/swiftshader.tar.br')))"
  tar xf "$TMP/swiftshader.tar" -C "$DEST"
  rm -rf "$TMP"
fi

# The launch shim, written every time. Bun.WebView starts this over a CDP pipe;
# a root-owned Chromium without --no-sandbox aborts ("Chrome process closed the pipe").
cat > "$SHIM" <<'EOF'
#!/bin/sh
exec /opt/chromium/chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  "$@"
EOF
chmod +x "$SHIM"

# 4. Tell the session where the browser is, so `bun test` finds it.
echo "export BUN_CHROME_PATH=$SHIM" >> "$CLAUDE_ENV_FILE"

#!/bin/bash
# SessionStart hook: makes a Claude Code web session ready for `bun test`, so a builder who opens
# the project there finds the suite green. One file for eta, delta and railroad (and a project
# `bun create` makes from eta): it reads what the project needs from the project, never from here.
#
#   Bun        the floor in package.json's engines.bun; below it, `bun upgrade`
#   Chromium   when a test names Bun.WebView: staged in /opt/chromium, BUN_CHROME_PATH set
#   Postgres   when `pg` is a dependency: the local cluster started, DELTA_TEST_PG_URL set
#
# Bun only (bun, bunx --bun, bun -e): never npm, npx or node. Progress goes to stderr; stdout
# would join the session's context. Idempotent. Outside the web sandbox (CLAUDE_CODE_REMOTE=true,
# on Linux) it does nothing at all: a Mac has Bun, and WebKit for Bun.WebView.
#
#   bash .claude/hooks/session-start.sh --dry-run    # anywhere: what it would do here, and stop
#
# Why the browser comes the way it does (found out in railroad's hook): the sandbox has no
# browser, apt's chromium is a snap stub, and the browser download hosts are blocked; npm's
# registry and GitHub are not, and @sparticuz/chromium carries a headless build inside its package.
set -euo pipefail

dry=0
[ "${1:-}" = "--dry-run" ] && dry=1
if [ "$dry" = 0 ] && { [ "${CLAUDE_CODE_REMOTE:-}" != "true" ] || [ "$(uname -s)" != "Linux" ]; }; then
  exit 0
fi
exec >&2
cd "${CLAUDE_PROJECT_DIR:-$PWD}"
[ -f package.json ] && command -v bun >/dev/null || exit 0 # not a Bun project, or no Bun to start from

log() { echo "[session-start] $*"; }
setenv() { log "$1"; [ -z "${CLAUDE_ENV_FILE:-}" ] || echo "export $1" >>"$CLAUDE_ENV_FILE"; }

# What the project needs, read from it.
{ read -r range; read -r bun_ok; read -r pg; } < <(bun -e '
  const p = await Bun.file("package.json").json();
  const range = p.engines?.bun ?? "*";
  console.log(range);
  console.log(Bun.semver.satisfies(Bun.version, range) ? 1 : 0);
  console.log("pg" in { ...p.dependencies, ...p.devDependencies } ? 1 : 0);')
chromium=0
grep -rqE 'Bun\.WebView' --include='*.test.*' --exclude-dir=node_modules --exclude-dir=.git . && chromium=1

if [ "$dry" = 1 ]; then
  log "bun $(bun --version), wants $range: $([ "$bun_ok" = 1 ] && echo ok || echo 'bun upgrade')"
  log "chromium: $([ "$chromium" = 1 ] && echo 'a test uses Bun.WebView' || echo 'not needed')"
  log "postgres: $([ "$pg" = 1 ] && echo 'pg is a dependency' || echo 'not needed')"
  exit 0
fi

# 1. Bun, up to the project's floor (the sandbox's image has shipped an older one).
if [ "$bun_ok" = 0 ]; then
  log "bun $(bun --version) is below $range: upgrading"
  bun upgrade
fi

# 2. Dependencies (`install`, so the container's cache is reused).
bun install

# 3. A headless Chromium for Bun.WebView, which on Linux speaks CDP to the browser BUN_CHROME_PATH names.
if [ "$chromium" = 1 ]; then
  DEST=/opt/chromium
  if [ ! -x "$DEST/chromium" ]; then
    log "staging chromium in $DEST"
    # Two preinstalled PPAs answer 403 and abort `apt update`.
    for f in /etc/apt/sources.list.d/deadsnakes-ubuntu-ppa-*.sources /etc/apt/sources.list.d/ondrej-ubuntu-php-*.sources; do
      [ -f "$f" ] && mv "$f" "$f.disabled" || true
    done
    bunx --bun playwright@latest install-deps chromium # its system libraries, from apt
    TMP="$(mktemp -d)"
    (cd "$TMP" && echo '{}' >package.json && bun add @sparticuz/chromium)
    mkdir -p "$DEST"
    FROM="$TMP/node_modules/@sparticuz/chromium/bin" TO="$DEST" bun -e '
      import { brotliDecompressSync } from "node:zlib";
      const { FROM, TO } = process.env;
      for (const [br, out] of [["chromium.br", `${TO}/chromium`], ["swiftshader.tar.br", `${FROM}/swiftshader.tar`]])
        await Bun.write(out, brotliDecompressSync(await Bun.file(`${FROM}/${br}`).bytes()));'
    chmod +x "$DEST/chromium"
    tar xf "$TMP/node_modules/@sparticuz/chromium/bin/swiftshader.tar" -C "$DEST" # software GL, found beside argv[0]
    rm -rf "$TMP"
  fi
  # Without --no-sandbox a root-owned Chromium aborts ("Chrome process closed the pipe").
  printf '#!/bin/sh\nexec %s/chromium --no-sandbox --disable-dev-shm-usage --disable-gpu "$@"\n' "$DEST" >"$DEST/chrome-shim.sh"
  chmod +x "$DEST/chrome-shim.sh"
  setenv "BUN_CHROME_PATH=$DEST/chrome-shim.sh"
fi

# 4. Postgres: the image's cluster, with delta's test role and database (its README's convention).
if [ "$pg" = 1 ]; then
  pg_isready -q || pg_ctlcluster "$(pg_lsclusters -h | awk 'NR==1 { print $1 }')" main start
  for _ in $(seq 20); do pg_isready -q && break; sleep 0.5; done
  psql_() { su postgres -c "psql -tAc \"$1\""; }
  [ "$(psql_ "SELECT 1 FROM pg_roles WHERE rolname='delta'")" = 1 ] || psql_ "CREATE ROLE delta LOGIN SUPERUSER PASSWORD 'delta'"
  [ "$(psql_ "SELECT 1 FROM pg_database WHERE datname='delta_test'")" = 1 ] || su postgres -c "createdb -O delta delta_test"
  setenv 'DELTA_TEST_PG_URL="postgres://delta:delta@localhost:5432/delta_test"'
fi

log "ready"

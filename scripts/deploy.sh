#!/usr/bin/env bash
#
# Run the tests, copy the static site into the web root, restart the MCP server.
#
#   bash scripts/deploy.sh
#   DEST=/var/www/somewhere SKIP_TESTS=1 bash scripts/deploy.sh
#
# DEST   web root (default /var/www/geometry - nginx cannot read /home/an)
# OWNER  user:group for the files (default root:www-data; empty = no chown)
# SUDO   command prefix for writing DEST (default sudo; empty = none)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${DEST:-/var/www/geometry}"
OWNER="${OWNER-root:www-data}"
SUDO="${SUDO-sudo}"

if [ "${SKIP_TESTS:-0}" != "1" ]; then
  echo "==> engine tests"
  node "$REPO/tests/run-tests.mjs"
  echo "==> browser smoke test"
  node "$REPO/tests/browser-smoke.mjs"
  echo "==> MCP server test"
  (cd "$REPO/mcp" && [ -d node_modules ] || npm ci --omit=dev --silent)
  node "$REPO/mcp/test.mjs"
  node "$REPO/mcp/widget-test.mjs"
  node "$REPO/mcp/apps-host-test.mjs"
fi

echo "==> copying to $DEST"
$SUDO mkdir -p "$DEST"
# Only what the browser loads. --delete-excluded removes anything that was
# deployed once and is excluded now.
$SUDO rsync -a --delete --delete-excluded \
  --include "/index.html" --include "/css/***" --include "/js/***" --exclude "*" \
  "$REPO"/ "$DEST"/

if [ -n "$OWNER" ]; then
  $SUDO chown -R "$OWNER" "$DEST"
  $SUDO find "$DEST" -type d -exec chmod 750 {} +
  $SUDO find "$DEST" -type f -exec chmod 640 {} +
fi
echo "==> deployed $($SUDO find "$DEST" -type f | wc -l) files to $DEST"

# The MCP server runs straight from this checkout (it imports ../js), so a
# deploy restarts it to pick up engine changes.
if systemctl list-unit-files geometry-mcp.service >/dev/null 2>&1 && systemctl is-enabled --quiet geometry-mcp 2>/dev/null; then
  echo "==> restarting geometry-mcp"
  $SUDO systemctl restart geometry-mcp
  for i in $(seq 1 20); do curl -fsS http://127.0.0.1:5040/healthz >/dev/null 2>&1 && break; sleep 0.25; done
  curl -fsS http://127.0.0.1:5040/healthz >/dev/null && echo "==> geometry-mcp healthy"
fi

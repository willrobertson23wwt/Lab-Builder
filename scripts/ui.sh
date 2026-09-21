#!/usr/bin/env bash
# Start the local lab-designer service (and serve web/dist if built).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$ROOT/.env" ]] || { echo "Missing $ROOT/.env" >&2; exit 1; }
exec "$ROOT/.venv/bin/uvicorn" --app-dir "$ROOT/server" app:app --host 127.0.0.1 --port "${PORT:-8765}" "$@"

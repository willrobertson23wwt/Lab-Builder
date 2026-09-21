#!/usr/bin/env bash
# Run terraform with credentials loaded from ./.env.
#   scripts/tf.sh <terraform args>              -> ./terraform (imported vApp power control)
#   scripts/tf.sh --lab <slug> <terraform args> -> ./labs/<slug>/terraform (a planned lab)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$ROOT/.env" ]]; then
  echo "Missing $ROOT/.env. Copy .env.example and fill it in." >&2
  exit 1
fi
set -a; # shellcheck disable=SC1091
source "$ROOT/.env"; set +a
DIR="$ROOT/terraform"
if [[ "${1:-}" == "--lab" ]]; then
  DIR="$ROOT/labs/$2/terraform"; shift 2
  [[ -d "$DIR" ]] || { echo "No such lab root: $DIR (run /lab-plan first)" >&2; exit 1; }
fi
exec terraform -chdir="$DIR" "$@"

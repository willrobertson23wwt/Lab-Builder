#!/usr/bin/env bash
# Usage: scripts/vapp-power.sh on|off|status [vapp-name]   (default: TF_VAR_vapp_name from .env)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a
ACTION="${1:-status}"; VAPP="${2:-${TF_VAR_vapp_name:?set TF_VAR_vapp_name in .env or pass a vApp name}}"
case "$ACTION" in
  on)  "$ROOT/scripts/tf.sh" apply -auto-approve -var "vapp_name=$VAPP" -var power_on=true ;;
  off) "$ROOT/scripts/tf.sh" apply -auto-approve -var "vapp_name=$VAPP" -var power_on=false ;;
  status) python3 "$ROOT/scripts/discover.py" --vapp "$VAPP" ;;
  *) echo "usage: $0 on|off|status [vapp-name]" >&2; exit 2 ;;
esac

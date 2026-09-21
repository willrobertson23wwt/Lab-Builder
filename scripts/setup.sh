#!/usr/bin/env bash
# One-shot install for Lab Builder on macOS or Linux. Safe to re-run.
#   scripts/setup.sh            # install everything, build the UI
#   scripts/setup.sh --check    # only report what is present / missing
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="${1:-}"
TF_VERSION="${TF_VERSION:-1.16.3}"
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
miss() { printf '  \033[33m•\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✘\033[0m %s\n' "$*" >&2; exit 1; }

echo "Lab Builder setup in $ROOT"

# --- Python 3.9+ ---------------------------------------------------------
PY=$(command -v python3 || true)
[[ -n "$PY" ]] || die "python3 not found. macOS: xcode-select --install. Linux: apt install python3 python3-venv."
ok "python3: $($PY --version 2>&1)"

# --- Node 20+ -----------------------------------------------------------
if command -v node >/dev/null; then ok "node: $(node --version)"; else miss "node not found (needed only for the web UI): https://nodejs.org or nvm install 22"; fi

# --- Terraform ----------------------------------------------------------
if command -v terraform >/dev/null; then
  ok "terraform: $(terraform version | head -1)"
elif [[ "$CHECK" == "--check" ]]; then
  miss "terraform not found"
else
  OS=$(uname -s | tr '[:upper:]' '[:lower:]'); ARCH=$(uname -m)
  case "$ARCH" in arm64|aarch64) ARCH=arm64;; x86_64|amd64) ARCH=amd64;; esac
  ZIP="terraform_${TF_VERSION}_${OS}_${ARCH}.zip"
  echo "  installing terraform $TF_VERSION to ~/.local/bin"
  mkdir -p "$HOME/.local/bin"; TMP=$(mktemp -d)
  curl -fsSL -o "$TMP/$ZIP" "https://releases.hashicorp.com/terraform/${TF_VERSION}/${ZIP}"
  curl -fsSL -o "$TMP/SUMS" "https://releases.hashicorp.com/terraform/${TF_VERSION}/terraform_${TF_VERSION}_SHA256SUMS"
  (cd "$TMP" && grep "$ZIP" SUMS | (command -v sha256sum >/dev/null && sha256sum -c - || shasum -a 256 -c -)) >/dev/null
  unzip -oq "$TMP/$ZIP" terraform -d "$HOME/.local/bin"; rm -rf "$TMP"
  export PATH="$HOME/.local/bin:$PATH"
  ok "terraform: $(terraform version | head -1)"
  case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) miss "add to your shell profile: export PATH=\"\$HOME/.local/bin:\$PATH\"";; esac
fi

[[ "$CHECK" == "--check" ]] && { [[ -f "$ROOT/.env" ]] && ok ".env present" || miss ".env missing (cp .env.example .env)"; exit 0; }

# --- Python venv for the local service -----------------------------------
if [[ ! -x "$ROOT/.venv/bin/uvicorn" ]]; then
  echo "  creating .venv and installing fastapi/uvicorn/pyyaml"
  "$PY" -m venv "$ROOT/.venv"
  "$ROOT/.venv/bin/pip" install -q --upgrade pip
  "$ROOT/.venv/bin/pip" install -q fastapi "uvicorn[standard]" pyyaml
fi
ok "python service deps (.venv)"

# --- Web UI --------------------------------------------------------------
if command -v npm >/dev/null; then
  (cd "$ROOT/web" && npm install --silent --no-audit --no-fund && npm run build --silent) && ok "web UI built (web/dist)"
fi

# --- Terraform providers for the power-control root -----------------------
(cd "$ROOT/terraform" && terraform init -input=false -no-color >/dev/null) && ok "terraform providers downloaded"

# --- .env ----------------------------------------------------------------
if [[ -f "$ROOT/.env" ]]; then
  ok ".env present"
else
  cp "$ROOT/.env.example" "$ROOT/.env"; chmod 600 "$ROOT/.env"
  miss "created .env from the template. EDIT IT: VCD_URL, VCD_ORG, VCD_USER, VCD_PASSWORD, then run"
  miss "  python3 scripts/discover.py    # lists your Org VDC name; put it in TF_VAR_vdc"
fi

echo
echo "Next: scripts/ui.sh  ->  http://127.0.0.1:8765"

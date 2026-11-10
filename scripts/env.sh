# Load ./.env into the environment WITHOUT running it as shell code, so a value
# with &, $, ;, backticks or spaces is taken literally. Same rules as
# scripts/discover.py load_env():
#   KEY=value            unquoted: trimmed; " #..." after it is a comment
#   KEY='value'          single or double quotes: everything inside, literally
#   export KEY=value     the "export " prefix is allowed
# Blank lines and lines starting with # are skipped. Values in .env win over
# the environment (as `source` did before).
# Usage (bash): source "$ROOT/scripts/env.sh"; load_env "$ROOT/.env"
load_env() {
  local file="$1" line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
    key="${line%%=*}"; key="${key#export }"
    key="${key#"${key%%[![:space:]]*}"}"; key="${key%"${key##*[![:space:]]}"}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    val="${line#*=}"; val="${val#"${val%%[![:space:]]*}"}"
    if [[ "$val" == \'* ]]; then val="${val#\'}"; val="${val%%\'*}"
    elif [[ "$val" == \"* ]]; then val="${val#\"}"; val="${val%%\"*}"
    else val="${val%%[[:space:]]#*}"; val="${val%"${val##*[![:space:]]}"}"
    fi
    export "$key=$val"
  done < "$file"
}

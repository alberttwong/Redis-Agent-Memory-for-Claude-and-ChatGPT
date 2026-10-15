#!/bin/zsh
set -eu

SCRIPT_DIR=${0:A:h}
PROJECT_DIR=${SCRIPT_DIR:h}

if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    source "$NVM_DIR/nvm.sh"
  fi
fi

if [[ ! -f "$PROJECT_DIR/dist/src/index.js" ]]; then
  cd "$PROJECT_DIR"
  npm run build >&2
fi

if [[ -f "$PROJECT_DIR/.env" ]]; then
  exec node --env-file="$PROJECT_DIR/.env" "$PROJECT_DIR/dist/src/index.js"
fi

exec node "$PROJECT_DIR/dist/src/index.js"

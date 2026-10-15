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

# The server resolves project .env first and shared Redis settings as fallback.
export MEMORY_CAPTURE_PROJECT_ROOT="$PROJECT_DIR"
exec node "$PROJECT_DIR/dist/src/index.js"

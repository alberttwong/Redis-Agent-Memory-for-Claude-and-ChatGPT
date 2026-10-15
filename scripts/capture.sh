#!/bin/zsh
set -eu
CAPTURE_SCRIPT_DIR=${0:A:h}
CAPTURE_BRIDGE_DIR=${CAPTURE_SCRIPT_DIR:h}
if ! command -v node >/dev/null 2>&1; then
  if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
    source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  fi
fi
if [[ ! -f "$CAPTURE_BRIDGE_DIR/dist/src/capture-cli.js" ]]; then
  print -u2 'Redis capture: run npm run build in the bridge project first.'
  exit 1
fi
if [[ -f "$CAPTURE_BRIDGE_DIR/.env" ]]; then
  exec node --env-file="$CAPTURE_BRIDGE_DIR/.env" "$CAPTURE_BRIDGE_DIR/dist/src/capture-cli.js" "$@"
fi
exec node "$CAPTURE_BRIDGE_DIR/dist/src/capture-cli.js" "$@"

#!/bin/sh
# Run the merged headless server with the workspace UI and persistent local data.
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SERVER_BIN="$PROJECT_DIR/target/debug/agent2api-server"
UI_DIR="$PROJECT_DIR/desktop-tauri/ui"
RUNTIME_DIR="$PROJECT_DIR/data/local/runtime/current"
if [ -L "$RUNTIME_DIR" ] || [ -d "$RUNTIME_DIR" ]; then
  SERVER_BIN="$RUNTIME_DIR/agent2api-server"
  UI_DIR="$RUNTIME_DIR/ui"
  if [ ! -x "$SERVER_BIN" ] || [ ! -f "$UI_DIR/index.html" ]; then
    echo "Active local runtime is incomplete: $RUNTIME_DIR" >&2
    exit 1
  fi
else
  cargo build --manifest-path "$PROJECT_DIR/desktop-tauri/src-tauri/server/Cargo.toml" --target-dir "$PROJECT_DIR/target"
fi
mkdir -p "$PROJECT_DIR/data/local"
chmod 700 "$PROJECT_DIR/data/local"
export AGENT2API_HOST=0.0.0.0
export AGENT2API_PROXY_PORT=3065
export AGENT2API_PROXY_HOME="$PROJECT_DIR/data/local"
export AGENT2API_UI_DIR="$UI_DIR"
exec "$SERVER_BIN"

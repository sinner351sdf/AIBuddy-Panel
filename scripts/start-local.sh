#!/bin/sh
# Run the merged headless server with the workspace UI and persistent local data.
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SERVER_BIN="$PROJECT_DIR/desktop-tauri/src-tauri/target/debug/agent2api-server"
cargo build --manifest-path "$PROJECT_DIR/desktop-tauri/src-tauri/server/Cargo.toml"
mkdir -p "$PROJECT_DIR/data/local"
chmod 700 "$PROJECT_DIR/data/local"
export AGENT2API_HOST=127.0.0.1
export AGENT2API_PROXY_PORT=3065
export AGENT2API_PROXY_HOME="$PROJECT_DIR/data/local"
export AGENT2API_UI_DIR="$PROJECT_DIR/desktop-tauri/ui"
exec "$SERVER_BIN"

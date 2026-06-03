#!/bin/sh
# Legacy reference only — runtime image uses entrypoint.mjs (see Dockerfile).
set -e

node /app/dist/runtime/gateway/main.js &
GW_PID=$!

node /app/dist/runtime/agent-worker/main.js &
AW_PID=$!

trap 'kill "$GW_PID" "$AW_PID" 2>/dev/null; exit' INT TERM

wait "$GW_PID" "$AW_PID"

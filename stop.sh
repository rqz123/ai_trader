#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  AI Trader — Stop script
#  Usage: bash stop.sh
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/app.pid"

if [ ! -f "$PID_FILE" ]; then
    echo "No PID file found — searching by process name..."
    PID=$(pgrep -f "python.*app.py" | head -1)
    if [ -z "$PID" ]; then
        echo "AI Trader is not running."
        exit 0
    fi
else
    PID=$(cat "$PID_FILE")
fi

if kill -0 "$PID" 2>/dev/null; then
    echo "Stopping AI Trader (PID $PID)..."
    kill "$PID"
    # Wait up to 8 seconds for graceful shutdown
    for i in $(seq 1 8); do
        sleep 1
        if ! kill -0 "$PID" 2>/dev/null; then
            rm -f "$PID_FILE"
            echo "AI Trader stopped."
            exit 0
        fi
    done
    # Force kill
    echo "Process did not exit — sending SIGKILL..."
    kill -9 "$PID" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "AI Trader force-stopped."
else
    echo "Process $PID is no longer running."
    rm -f "$PID_FILE"
fi

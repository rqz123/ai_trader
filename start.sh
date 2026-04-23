#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  AI Trader — Start script
#  Usage: bash start.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PID_FILE="$SCRIPT_DIR/app.pid"
LOG_FILE="$SCRIPT_DIR/app.log"

# Check if already running
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "AI Trader is already running (PID $PID) — no action needed."
        echo "   UI: http://localhost:8080"
        exit 0
    else
        # Stale PID file — clean up
        rm -f "$PID_FILE"
    fi
fi

# Check venv
if [ ! -d "$SCRIPT_DIR/venv" ]; then
    echo "ERROR: venv not found. Run 'bash setup.sh' first."
    exit 1
fi

source "$SCRIPT_DIR/venv/bin/activate"

echo "==================================================="
echo "  AI Trader — Starting"
echo "==================================================="

# Start in background, append output to app.log
nohup python "$SCRIPT_DIR/app.py" >> "$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"

# Wait up to 10 seconds to confirm the process is alive
for i in $(seq 1 10); do
    sleep 1
    if kill -0 "$PID" 2>/dev/null; then
        echo "Started successfully (PID $PID)"
        echo ""
        echo "  Local:  http://localhost:8080"
        echo "  LAN:    http://$(hostname -I | awk '{print $1}'):8080"
        echo "  SSH:    ssh -L 8080:localhost:8080 <user>@<server-ip>"
        echo "          then open http://localhost:8080"
        echo ""
        echo "  Logs:   tail -f $LOG_FILE"
        echo "  Stop:   bash stop.sh"
        echo "==================================================="
        exit 0
    fi
done

echo "ERROR: Startup failed. Check logs: $LOG_FILE"
rm -f "$PID_FILE"
exit 1

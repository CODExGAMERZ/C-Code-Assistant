#!/bin/bash
# ═══════════════════════════════════════════════
#   C Code Assistant — Start Script
#   Usage: bash start.sh
# ═══════════════════════════════════════════════

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=5050

echo ""
echo "╔══════════════════════════════════════╗"
echo "║     C Code Assistant — Startup       ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── Check Python ──────────────────────────────
if ! command -v python3 &>/dev/null; then
    echo "❌  python3 not found. Please install Python 3.8+"
    exit 1
fi

# ── Install dependencies ──────────────────────
echo "📦  Checking Python dependencies..."
python3 -m pip install flask flask-cors --quiet --break-system-packages 2>/dev/null \
    || python3 -m pip install flask flask-cors --quiet

echo "✅  Dependencies OK"

# ── Kill any old instance on same port ────────
if command -v lsof &>/dev/null; then
    OLD_PID=$(lsof -ti :$PORT 2>/dev/null || true)
    if [ -n "$OLD_PID" ]; then
        echo "🔄  Killing old process on port $PORT (PID $OLD_PID)..."
        kill -9 $OLD_PID 2>/dev/null || true
        sleep 1
    fi
fi

# ── Start backend ─────────────────────────────
echo ""
echo "🔧  Starting backend on http://localhost:$PORT ..."
cd "$DIR"
python3 server.py &
BACKEND_PID=$!

# Wait and verify it came up
sleep 2
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "❌  Backend failed to start. Check server.py for errors."
    exit 1
fi

# Quick health check
if command -v curl &>/dev/null; then
    STATUS=$(curl -s --max-time 3 http://localhost:$PORT/api/health 2>/dev/null || echo "")
    if [ -n "$STATUS" ]; then
        echo "✅  Backend healthy"
    else
        echo "⚠️   Backend started but health check timed out (it may still work)"
    fi
fi

# ── Ollama reminder ───────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Make sure Ollama is running:"
echo "  OLLAMA_ORIGINS='*' ollama serve"
echo ""
echo "  Pull the model (first time only):"
echo "  ollama pull qwen2.5-coder:1.5b"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Open browser ──────────────────────────────
echo ""
echo "🌐  Opening index.html in browser..."
INDEX="$DIR/index.html"
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "$INDEX"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open "$INDEX" 2>/dev/null || echo "   Open manually: $INDEX"
elif [[ "$OSTYPE" == "msys"* || "$OSTYPE" == "cygwin"* ]]; then
    start "$INDEX"
fi

echo ""
echo "✅  Backend PID: $BACKEND_PID"
echo "   Press Ctrl+C to stop"
echo ""

# Keep alive and forward logs
wait $BACKEND_PID

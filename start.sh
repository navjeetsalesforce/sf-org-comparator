#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# SF Org Comparator — start both backend and frontend
# ─────────────────────────────────────────────────────────────────────────────
# Backend  → http://localhost:8000
# Frontend → http://localhost:5173
# ─────────────────────────────────────────────────────────────────────────────

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "╔════════════════════════════════════════╗"
echo "║      SF Org Comparator  v1.0.0         ║"
echo "╚════════════════════════════════════════╝"
echo ""

# ─── Backend ─────────────────────────────────────────────────────────────────
echo "[backend] Installing Python dependencies…"
cd "$ROOT_DIR/backend"
# Use pip3 if pip is not available (common on macOS)
PIP_CMD=$(command -v pip3 || command -v pip || echo "")
if [ -z "$PIP_CMD" ]; then
  echo "ERROR: pip/pip3 not found. Please install Python 3.11+"
  exit 1
fi
$PIP_CMD install -r requirements.txt -q

echo "[backend] Starting FastAPI on :8000…"
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
echo "[backend] PID=$BACKEND_PID"

# ─── Frontend ─────────────────────────────────────────────────────────────────
echo ""
echo "[frontend] Installing npm dependencies…"
cd "$ROOT_DIR/frontend"
npm install --cache /tmp/npm-sf-comparator-cache -q

echo "[frontend] Starting Vite dev server on :5173…"
echo ""
echo "  Open: http://localhost:5173"
echo ""

# Trap to kill backend when the script is interrupted
trap "echo ''; echo 'Shutting down…'; kill $BACKEND_PID 2>/dev/null; exit 0" INT TERM

npm run dev

# If frontend exits, kill backend too
kill $BACKEND_PID 2>/dev/null

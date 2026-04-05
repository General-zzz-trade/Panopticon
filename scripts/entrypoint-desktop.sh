#!/bin/bash
set -e

echo "╔══════════════════════════════════════════════════╗"
echo "║  Agent-Orchestrator Desktop Environment          ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Display:  ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}             ║"
echo "║  noVNC:    http://localhost:${NOVNC_PORT}              ║"
echo "║  Agent API: http://localhost:3000               ║"
echo "╚══════════════════════════════════════════════════╝"

# ── 1. Start virtual display ─────────────────────────────────────────────
echo "[desktop] Starting Xvfb on :99..."
Xvfb :99 -screen 0 ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH} -ac +extension GLX +render -noreset &
XVFB_PID=$!
sleep 1

# Verify Xvfb is running
if ! kill -0 $XVFB_PID 2>/dev/null; then
    echo "[desktop] ERROR: Xvfb failed to start"
    exit 1
fi
echo "[desktop] Xvfb running (PID: $XVFB_PID)"

# ── 2. Start VNC server ─────────────────────────────────────────────────
echo "[desktop] Starting x11vnc on :${VNC_PORT}..."
x11vnc -display :99 -nopw -listen 0.0.0.0 -rfbport ${VNC_PORT} \
    -shared -forever -ncache 10 -bg -o /tmp/x11vnc.log 2>&1
sleep 1
echo "[desktop] x11vnc running"

# ── 3. Start noVNC (web-based VNC viewer) ────────────────────────────────
echo "[desktop] Starting noVNC on :${NOVNC_PORT}..."

# Find noVNC installation path (varies by distro)
NOVNC_PATH=""
for p in /usr/share/novnc /usr/share/novnc/utils /usr/share/websockify; do
    if [ -d "$p" ]; then NOVNC_PATH="$p"; break; fi
done

websockify --web /usr/share/novnc ${NOVNC_PORT} localhost:${VNC_PORT} &
NOVNC_PID=$!
sleep 1
echo "[desktop] noVNC running (PID: $NOVNC_PID)"

# ── 4. Configure Playwright to use the virtual display ───────────────────
export DISPLAY=:99
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(find /root -name chrome -type f 2>/dev/null | head -1)

# Tell Playwright to run in headed mode (visible on the virtual display)
# so you can watch via noVNC
export PLAYWRIGHT_HEADED=true

# ── 5. Start the Agent API server ────────────────────────────────────────
echo "[desktop] Starting Agent API server..."

if [ "$1" = "dev" ]; then
    echo "[desktop] Running in development mode (tsx)"
    exec node --import tsx src/api/server.ts
elif [ "$1" = "goal" ]; then
    shift
    echo "[desktop] Running goal: $*"
    exec node --import tsx src/cli.ts "$@"
elif [ "$1" = "computer-use" ]; then
    shift
    echo "[desktop] Running computer-use mode: $*"
    exec node --import tsx -e "
const { runComputerUseGoal } = require('./src/computer-use/agent');
runComputerUseGoal('$*', { startUrl: '${START_URL:-}' })
  .then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(r.success ? 0 : 1); })
  .catch(e => { console.error(e); process.exit(1); });
"
elif [ -n "$1" ]; then
    exec "$@"
else
    exec node dist/api/server.js
fi

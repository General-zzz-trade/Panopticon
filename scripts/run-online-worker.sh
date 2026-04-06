#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_ENV_FILE="$HOME/.config/osint-agent/moonshot.env"
FALLBACK_ENV_FILE="$ROOT_DIR/artifacts/online-worker/moonshot.env"
DEFAULT_PROXY_ENV_FILE="$HOME/.config/osint-agent/proxy.env"
FALLBACK_PROXY_ENV_FILE="$ROOT_DIR/artifacts/online-worker/proxy.env"
ENV_FILE="${AGENT_ONLINE_ENV_FILE:-$DEFAULT_ENV_FILE}"
PROXY_ENV_FILE="${AGENT_PROXY_ENV_FILE:-$DEFAULT_PROXY_ENV_FILE}"
MODE="${1:-verify}"

if [[ "$ENV_FILE" == "$DEFAULT_ENV_FILE" && ! -f "$ENV_FILE" && -f "$FALLBACK_ENV_FILE" ]]; then
  ENV_FILE="$FALLBACK_ENV_FILE"
fi

if [[ "$PROXY_ENV_FILE" == "$DEFAULT_PROXY_ENV_FILE" && ! -f "$PROXY_ENV_FILE" && -f "$FALLBACK_PROXY_ENV_FILE" ]]; then
  PROXY_ENV_FILE="$FALLBACK_PROXY_ENV_FILE"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Set AGENT_ONLINE_ENV_FILE or create $DEFAULT_ENV_FILE" >&2
  echo "Fallback path also supported: $FALLBACK_ENV_FILE" >&2
  exit 1
fi

set -a
. "$ENV_FILE"
if [[ -f "$PROXY_ENV_FILE" ]]; then
  . "$PROXY_ENV_FILE"
fi
set +a

echo "Online worker root: $ROOT_DIR"
echo "Using env file: $ENV_FILE"
if [[ -f "$PROXY_ENV_FILE" ]]; then
  echo "Using proxy env file: $PROXY_ENV_FILE"
fi
echo "Proxy: ${HTTPS_PROXY:-${HTTP_PROXY:-none}}"

cd "$ROOT_DIR"

case "$MODE" in
  verify)
    exec node --import tsx src/verify-moonshot.ts
    ;;
  planner-smoke)
    exec node --import tsx --test src/planner.provider.smoke.test.ts
    ;;
  replanner-smoke)
    exec node --import tsx --test src/replanner.provider.smoke.test.ts
    ;;
  diagnoser-smoke)
    exec node --import tsx --test src/diagnoser.provider.smoke.test.ts
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    echo "Usage: scripts/run-online-worker.sh [verify|planner-smoke|replanner-smoke|diagnoser-smoke]" >&2
    exit 1
    ;;
esac

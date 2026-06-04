#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_ROOT="$(cd "$ROOT_DIR/.." && pwd)"

if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

fail() {
  echo "[E2E][NG] $1" >&2
  exit 1
}

need_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail "missing env: $name"
  fi
}

need_var OPENCLAW_GATEWAY_BIN
need_var LMSTUDIO_BASE_URL
need_var SLACK_BOT_USER_OAUTH_TOKEN
need_var SLACK_CHANNEL_ID

NODE22_DIR="$(dirname "$OPENCLAW_GATEWAY_BIN")"
PATH="$NODE22_DIR:$PATH"

OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-$PROJECT_ROOT/.openclaw-state}"
OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$OPENCLAW_STATE_DIR/openclaw.json}"
OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-easy-openclaw-test-token}"
export OPENCLAW_STATE_DIR OPENCLAW_CONFIG_PATH OPENCLAW_GATEWAY_TOKEN
mkdir -p "$OPENCLAW_STATE_DIR"

echo "[E2E] node: $(node --version)"

LM_STATUS="$(curl -sS -m 8 -w '%{http_code}' -o /tmp/easy-openclaw-lmstudio.json "$LMSTUDIO_BASE_URL/models")"
[[ "$LM_STATUS" == "200" ]] || fail "LMStudio HTTP status $LM_STATUS"
echo "[E2E] LMStudio: ok"

SLACK_READ_OK="$(curl -sS -m 10 -H "Authorization: Bearer $SLACK_BOT_USER_OAUTH_TOKEN" "https://slack.com/api/conversations.history?channel=$SLACK_CHANNEL_ID&limit=1" | rg -o '"ok":(true|false)' | head -n1 || true)"
[[ "$SLACK_READ_OK" == '"ok":true' ]] || fail "Slack read failed"
echo "[E2E] Slack read: ok"

SLACK_WRITE_OK="$(curl -sS -m 10 -X POST -H "Authorization: Bearer $SLACK_BOT_USER_OAUTH_TOKEN" -H "Content-type: application/json; charset=utf-8" --data "{\"channel\":\"$SLACK_CHANNEL_ID\",\"text\":\"[easy-openclaw] e2e smoke test\"}" https://slack.com/api/chat.postMessage | rg -o '"ok":(true|false)' | head -n1 || true)"
[[ "$SLACK_WRITE_OK" == '"ok":true' ]] || fail "Slack write failed"
echo "[E2E] Slack write: ok"

LOG_FILE="/tmp/easy-openclaw-e2e-gateway.log"
"$OPENCLAW_GATEWAY_BIN" gateway --allow-unconfigured > "$LOG_FILE" 2>&1 &
GPID=$!
trap 'kill "$GPID" >/dev/null 2>&1 || true; wait "$GPID" >/dev/null 2>&1 || true' EXIT
sleep 8

HEALTH_JSON="$($OPENCLAW_GATEWAY_BIN health --json 2>&1 || true)"
echo "$HEALTH_JSON" | rg -q '"ok":\s*true' || fail "gateway health failed"

echo "[E2E] gateway health: ok"

echo "[E2E] smoke test: ok"

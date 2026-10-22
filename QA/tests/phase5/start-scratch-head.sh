#!/usr/bin/env bash
# Scratch API for the Phase 5 write-abuse re-run (test-results/04-api-testing.md).
#   - runs the API from SOURCE (tsx) of a git worktree pinned at one commit, so every verdict
#     maps to a commit, not to someone's uncommitted edits in the main tree
#   - database: digilog_qa_perf ONLY (refuses anything else), port 3112
#   - LOG_DIR / UPLOAD_DIR in the OS temp folder (digilog-p5-scratch)
#   - secrets come from the main tree's apps/api/.env (DOTENV_CONFIG_PATH); nothing is copied
# Usage (Git Bash):  bash QA/tests/phase5/start-scratch-head.sh <worktree-path>
# Stop: the node process listening on 3112 (Get-NetTCPConnection -LocalPort 3112), nothing else.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
WT="${1:?worktree path required}"
API="$WT/apps/api"
[ -f "$API/src/app.ts" ] || { echo "no apps/api/src/app.ts under $WT"; exit 2; }
TMPROOT="${LOCALAPPDATA:-${TMPDIR:-/tmp}}"
TMPROOT="${TMPROOT//\\//}"
SCRATCH="$TMPROOT/Temp/digilog-p5-scratch"
[ -d "$TMPROOT/Temp" ] || SCRATCH="$TMPROOT/digilog-p5-scratch"
export DOTENV_CONFIG_PATH="$REPO/apps/api/.env"
base=$(grep -E '^DATABASE_URL=' "$DOTENV_CONFIG_PATH" | head -1 | cut -d= -f2- | tr -d '"\r')
export DATABASE_URL=$(printf '%s' "$base" | sed -E 's#/([A-Za-z0-9_]+)(\?|$)#/digilog_qa_perf\2#')
case "$DATABASE_URL" in *"/digilog_qa_perf"*) ;; *) echo "REFUSING: DATABASE_URL is not digilog_qa_perf"; exit 2;; esac
export PORT=3112
export API_PORT=3112
export NODE_ENV=production
export API_DOCS=on
export TLS_KEY_PATH="$REPO/certs/server.key"
export TLS_CERT_PATH="$REPO/certs/server.crt"
export LOG_DIR="$SCRATCH/logs"
export UPLOAD_DIR="$SCRATCH/uploads"
mkdir -p "$LOG_DIR" "$UPLOAD_DIR"
echo "scratch API: src=$WT ($(git -C "$WT" rev-parse --short HEAD)) db=digilog_qa_perf port=$PORT logs=$LOG_DIR"
cd "$API"
exec npx tsx src/app.ts

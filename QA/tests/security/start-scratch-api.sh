#!/usr/bin/env bash
# Scratch API for the 06 security probes (test-results/06-security-assessment.md).
#   - runs the API from SOURCE (tsx): no build, nothing written in the repo
#   - database: digilog_qa_perf ONLY (refuses anything else), port 3110
#   - LOG_DIR / UPLOAD_DIR in the OS temp folder (digilog-sec-scratch)
# Usage (Git Bash):  bash QA/tests/security/start-scratch-api.sh [on|off]   # on|off = API_DOCS (default off)
# Stop: the node process listening on 3110 (Get-NetTCPConnection -LocalPort 3110), nothing else.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
API="$REPO/apps/api"
TMPROOT="${LOCALAPPDATA:-${TMPDIR:-/tmp}}"
TMPROOT="${TMPROOT//\\//}"
SCRATCH="$TMPROOT/Temp/digilog-sec-scratch"
[ -d "$TMPROOT/Temp" ] || SCRATCH="$TMPROOT/digilog-sec-scratch"
unset DOTENV_CONFIG_PATH || true
base=$(grep -E '^DATABASE_URL=' "$API/.env" | head -1 | cut -d= -f2- | tr -d '"\r')
export DATABASE_URL=$(printf '%s' "$base" | sed -E 's#/([A-Za-z0-9_]+)(\?|$)#/digilog_qa_perf\2#')
case "$DATABASE_URL" in *"/digilog_qa_perf"*) ;; *) echo "REFUSING: DATABASE_URL is not digilog_qa_perf"; exit 2;; esac
export PORT=3110
export NODE_ENV=production
export API_DOCS="${1:-off}"
export LOG_DIR="$SCRATCH/logs"
export UPLOAD_DIR="$SCRATCH/uploads"
mkdir -p "$LOG_DIR" "$UPLOAD_DIR"
echo "scratch API: db=digilog_qa_perf port=$PORT API_DOCS=$API_DOCS logs=$LOG_DIR"
cd "$API"
exec npx tsx src/app.ts

#!/usr/bin/env bash
# Scratch API for the deliverable-04 role x route re-run (test-results/04-api-testing.md).
#   - runs the API from SOURCE (tsx) out of a `git archive` of a COMMIT (default HEAD), not the
#     working tree: other agents' uncommitted edits are not under test
#   - the extract lives in $P4_SCRATCH/head; its node_modules is a junction farm onto the repo's
#     node_modules, except @digilog/{shared,api}, which point at the extract (shared dist rebuilt there)
#   - database: digilog_qa_perf ONLY (refuses anything else), port 3111, API_DOCS on (scratch only)
#   - LOG_DIR / UPLOAD_DIR inside $P4_SCRATCH; .env values read from apps/api/.env (DOTENV_CONFIG_PATH),
#     every value that matters is set explicitly and wins over the file
# Prepare (once per commit): see "prepare" below. Usage (Git Bash):
#   P4_SCRATCH=/c/.../scratchpad bash QA/tests/phase4/start-head-api.sh
# Stop: the node process listening on 3111, nothing else.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
: "${P4_SCRATCH:?set P4_SCRATCH to a scratch folder outside the repo}"
HEADDIR="$P4_SCRATCH/head"
[ -f "$HEADDIR/HEAD_SHA" ] || { echo "no extract at $HEADDIR (git archive -o x.tar <sha> apps/api packages/shared package.json; tar -x; junction node_modules; tsc -p packages/shared)"; exit 2; }
unset DOTENV_CONFIG_PATH || true
base=$(grep -E '^DATABASE_URL=' "$REPO/apps/api/.env" | head -1 | cut -d= -f2- | tr -d '"\r')
export DATABASE_URL=$(printf '%s' "$base" | sed -E 's#/([A-Za-z0-9_]+)(\?|$)#/digilog_qa_perf\2#')
case "$DATABASE_URL" in *"/digilog_qa_perf"*) ;; *) echo "REFUSING: DATABASE_URL is not digilog_qa_perf"; exit 2;; esac
export DOTENV_CONFIG_PATH="$REPO/apps/api/.env"
export PORT=3111
export NODE_ENV=production
export API_DOCS=on
export API_HTTPS=true
export TLS_KEY_PATH="$REPO/certs/server.key"
export TLS_CERT_PATH="$REPO/certs/server.crt"
export LOG_DIR="$P4_SCRATCH/api-3111/logs"
export UPLOAD_DIR="$P4_SCRATCH/api-3111/uploads"
mkdir -p "$LOG_DIR" "$UPLOAD_DIR"
echo "scratch API: commit=$(cat "$HEADDIR/HEAD_SHA") db=digilog_qa_perf port=$PORT logs=$LOG_DIR"
cd "$HEADDIR/apps/api"
exec node "$HEADDIR/node_modules/tsx/dist/cli.mjs" src/app.ts

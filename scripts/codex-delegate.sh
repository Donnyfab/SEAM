#!/bin/bash
# Delegate one bounded task to Codex in its own git worktree (branch codex/<id>).
# Usage: scripts/codex-delegate.sh <task-id> "<instruction>"
# Codex's sandbox has no network, so dependencies are installed here first (npm ci).
# Codex cannot write the worktree's git index, so this script commits its work afterwards.
set -euo pipefail
ID=${1:?task id}; PROMPT=${2:?instruction}
CODEX=${CODEX_BIN:-/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex}
ROOT=$(git rev-parse --show-toplevel); WT="$ROOT/../SEAM-wt/$ID"; OUT="$ROOT/.agent-runs"; mkdir -p "$OUT"
[ -d "$WT" ] || git worktree add -q -b "codex/$ID" "$WT"
cd "$WT"; npm ci --silent >/dev/null 2>&1
set +e
"$CODEX" exec --sandbox workspace-write -C "$WT" -o "$OUT/$ID.last.txt" \
  "Read AGENTS.md and HANDOFF.md. Task $ID: $PROMPT. Touch only the files named in the task. Run 'npm test' and 'npm run typecheck'. Do not run git commit. Reply with a 3-line summary." \
  </dev/null >"$OUT/$ID.log" 2>&1
rc=$?
set -e
git add -A
if ! git diff --cached --quiet; then
  git -c user.name=Codex -c user.email=217367345+Donnyfab@users.noreply.github.com commit -qm "$ID: Codex work (rc=$rc)"
fi
if [ $rc -ne 0 ]; then
  echo "- $(date -u +%FT%TZ) codex exited $rc on $ID; partial work committed on codex/$ID in $WT; log $OUT/$ID.log. Claude should review/take over." >> "$ROOT/HANDOFF.md"
  exit $rc
fi
echo "Done $ID. Review: git diff main...codex/$ID"

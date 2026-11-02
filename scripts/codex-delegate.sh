#!/bin/bash
# Delegate one bounded task from TASKS.md to Codex in its own git worktree.
# Usage: scripts/codex-delegate.sh <task-id> "<instruction>"
# Codex runs sandboxed (workspace-write), non-interactive, on branch codex/<task-id>. Claude reviews + merges.
set -euo pipefail
ID=${1:?task id}; PROMPT=${2:?instruction}
CODEX=${CODEX_BIN:-/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex}
ROOT=$(git rev-parse --show-toplevel); WT="$ROOT/../SEAM-wt/$ID"; OUT="$ROOT/.agent-runs"; mkdir -p "$OUT"
[ -d "$WT" ] || git worktree add -q -b "codex/$ID" "$WT"
cd "$WT"
set +e
"$CODEX" exec --sandbox workspace-write -C "$WT" -o "$OUT/$ID.last.txt" \
  "Read AGENTS.md and HANDOFF.md. Task $ID from TASKS.md: $PROMPT. Stay within the task's listed paths. Run scripts/test-clt.sh. Commit on this branch. Reply with a short summary." \
  >"$OUT/$ID.log" 2>&1
rc=$?
set -e
# Usage-limit or auth failure: work stays committed/uncommitted in the worktree; write a handoff note.
if [ $rc -ne 0 ]; then
  echo "codex exited $rc at $(date -u +%FT%TZ); partial work preserved in $WT (branch codex/$ID). See $OUT/$ID.log. Claude should take over $ID." >> "$ROOT/HANDOFF.md"
  echo "Codex failed (rc=$rc); handoff note appended." >&2; exit $rc
fi
echo "Done. Review: git -C '$ROOT' diff main...codex/$ID"

# SEAM — shared agent instructions (Claude + Codex)

SEAM is a personal, free, native iOS music player (Swift/SwiftUI/AVAudioEngine) with an "EP Transition Studio".
Read HANDOFF.md first, then only the task you were assigned in TASKS.md. Do not re-read the whole repo.

## Rules
- One task = one branch/worktree (`claude/<task-id>` or `codex/<task-id>`). Never edit files outside your task's listed paths.
- Pure logic goes in `Sources/SEAMCore` (no UIKit/SwiftUI, testable with `swift test`). Audio/UI go in the app target.
- Every change ships with tests. Run `scripts/test-clt.sh` (no Xcode) or `swift test` (Xcode) before handing back.
- Swift 6 strict concurrency. No force-unwraps in production code. No third-party deps without owner approval.
- Never write secrets/API keys to the repo. Never run destructive git/file commands without owner approval.
- No placeholder buttons: a feature is either working and tested, or absent and listed in ROADMAP.md as not done.
- When finished: update TASKS.md status, append to HANDOFF.md "Done", commit on your branch. Claude merges.

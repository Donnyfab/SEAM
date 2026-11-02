# ARCHITECTURE
## Layers
1. **SEAMCore** (Swift package, no UI): models, queue logic, arrangement timeline, crossfade math, formatters, renderers. Fully unit-tested on macOS.
2. **SEAMAudio** (app/package, AVFoundation): `PlaybackEngine` using AVAudioEngine with two player nodes + mixer for crossfade; next track scheduled sample-accurately via `AVAudioTime` for gapless. Offline mix render uses `enableManualRenderingMode` so exports are deterministic and testable.
3. **SEAMStorage**: library DB (SwiftData or SQLite via GRDB — decide at Phase 2), security-scoped bookmarks for imported files, app Documents for copies.
4. **SEAMConnect**: protocol `RemoteSource` (list/stream/download) with implementations per provider; Phase 4.
5. **SEAMApp** (SwiftUI): tabs Lists / Library / Studio / Connect / Files / Settings. Original styling, not Evermusic's.
## Decisions
- Swift 6, iOS 17+, Swift Testing. No third-party deps until approved.
- Per-transition settings live on the Arrangement (clamped overlap), trims are offsets only — source files never modified.
- Reorder resets adjacent transitions (they described different pairs).
## Engineering risks
Sample-accurate gapless across formats/sample rates (resample to a common engine format) · background audio + interruptions · security-scoped URL lifetime · large-library scan performance · iOS 7-day signing without paid account.
## Claude–Codex workflow
- Claude plans, writes tasks in TASKS.md with exact paths, reviews/merges. Codex gets bounded tasks through `scripts/codex-delegate.sh` (worktree `../SEAM-wt/<id>`, branch `codex/<id>`, `codex exec` sandboxed workspace-write). Prompt = AGENTS.md + one task, not history.
- Failure/usage-limit: script exits non-zero, appends a note to HANDOFF.md; work stays in the worktree. Either agent resumes from HANDOFF.md + git. Usage is checked only via the CLIs/apps themselves; limits are not bypassed. A local script can switch agents because state lives in git + markdown, not in any session.

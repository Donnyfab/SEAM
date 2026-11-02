# HANDOFF (keep under 60 lines)
## State (2026-11-01)
- Repo initialised. SEAMCore package builds; 16 Swift Testing tests pass via `scripts/test-clt.sh`.
- Xcode is NOT installed (Command Line Tools only) -> no iOS app target, simulator or device install yet. 16 GB disk free; Xcode needs ~40 GB.
- Codex: bundled CLI at /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex (0.165.0-alpha), logged in with ChatGPT. Use `scripts/codex-delegate.sh`.
## Next
1. Owner frees disk + installs Xcode (App Store) -> create app target (T004/T005 unblock).
2. Run T002 on Codex as a pipeline smoke test; review its branch.
3. T003, T006 (Codex); T007 (Claude).
## Decisions
- Logic-first: SEAMCore is UI/audio-framework independent so it stays testable without Xcode.
- Swift Testing, not XCTest.
## Open issues
- Real Evermusic-parity items needing credentials/entitlements are tracked in ROADMAP.md.

# TASKS
Status: todo | doing | review | done. Owner: claude | codex. Paths = the only files a task may touch.

| ID | Task | Owner | Status | Paths |
|----|------|-------|--------|-------|
| T001 | Repo, SEAMCore: Crossfade, Arrangement, PlayQueue + tests | claude | done | Sources/SEAMCore, Tests |
| T002 | Codex smoke test via `scripts/codex-delegate.sh` (add `Clip.fadeIn/fadeOut` edge fades + tests) | codex | done | Sources/SEAMCore/Arrangement.swift, Tests |
| T003 | Library model: Track, Album/Artist grouping, search/sort, Codable persistence + tests | codex | todo | Sources/SEAMCore/Library |
| T004 | Metadata reader (AVAsset: title/artist/album/artwork/duration) | claude | blocked: Xcode for iOS target | App/ |
| T005 | Audio engine: AVAudioEngine two-player crossfade + gapless scheduling | claude | blocked: Xcode | App/Audio |
| T006 | Waveform peak extraction (Accelerate) + tests on generated tone files | codex | todo | Sources/SEAMCore/Waveform |
| T007 | Arrangement offline renderer: continuous preview mix to WAV/M4A | claude | todo | Sources/SEAMCore/Render |

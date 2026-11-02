# TASKS
Status: todo | doing | review | done. Owner: claude | codex. Paths = the only files a task may touch.

| ID | Task | Owner | Status | Paths |
|----|------|-------|--------|-------|
| T001 | Repo, SEAMCore: Crossfade, Arrangement, PlayQueue + tests | claude | done | Sources/SEAMCore, Tests |
| T003 | Library model: src/library/model.ts + tests/library.test.ts (Track type, searchTracks, sortTracks, groupAlbums/Artists/Genres, unplayed filter) | codex | doing | src/library/model.ts, tests/library.test.ts |
| T006 | DSP utils: src/audio/wav.ts (encodeWav 16/24/32f), src/audio/peaks.ts (computePeaks, detectSilenceBounds, findTransitionPoints) + tests | codex | doing | src/audio/wav.ts, src/audio/peaks.ts, tests/audio.test.ts |
| T010 | Web Audio engine: gapless + crossfade scheduling, Media Session | claude | doing | src/audio/engine.ts |
| T011 | Library storage (IndexedDB/OPFS), import, metadata, player UI | claude | todo | src/library, src/ui |
| T012 | EP Transition Studio UI + offline mix render | claude | todo | src/ui/studio |
| T013 | iOS device spike page (background audio, gapless, FLAC, storage) | claude | doing | public/spike.html |

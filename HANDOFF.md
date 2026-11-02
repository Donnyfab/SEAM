# HANDOFF (keep short)
## State (2026-11-01)
- Pivoted from native iOS to an iOS-installable PWA (no Xcode / Apple account). Stack and reasoning: ARCHITECTURE.md. Swift prototype kept in `legacy/`.
- Working: import (tags+artwork), library views, playlists, gapless/crossfade playback, Now Playing sheet, Media Session, Studio (arrangements, waveform trims, per-transition crossfade, preview, WAV mix export, tracklist/JSON), PWA install + offline shell. 117 unit tests; WAV export and gapless timing verified in browser.
- NOT verified: anything on a real iPhone (background audio, memory, FLAC/ALAC decode, storage persistence). `/spike.html` is the test page.
- Codex: bundled CLI (ChatGPT app), logged in. T020 (loudness) and T021 (Subsonic client) merged; effects chain + normalization wired in. Use `scripts/codex-delegate.sh`.
## Update (2026-11-02)
- Added audiobook player, bookmarks, resume, metadata/lyrics editor, visualizer, Connect tab (WebDAV/Subsonic/Jellyfin/radio/cloud OAuth), backup/restore, passcode, Last.fm, accessibility, tag export. 326 tests. WebDAV, backup/restore and audiobooks verified in browser; cloud providers and Last.fm only mock-tested (need user credentials).
- Dev note: Vite HMR can create duplicate module instances (state.ts?t=...). Reload the page before testing from the console.
## Update: Playlists redesign
- New tab order Playlists | Library | Studio | Connect | Settings; `src/ui/Playlists.tsx` (list + detail), `Glass.tsx` (menus, sheets, promise dialogs replacing prompt/confirm), `Icon.tsx`, `useSortable.ts`. Engine gained `insertItems`/`rescheduleNext` so Play next/later re-plan the scheduled next track (verified with crossfade). New strings use plural base keys (`songCount`, `minutesCount`…) in i18n.
## Next
1. Deployed: https://donnyfab.github.io/SEAM/ (push to main redeploys). Owner: run /spike.html and the docs/IPHONE_TEST.md checklist on iPhone and paste the log.
2. Start T022 (WebDAV client, Codex), T031 (Connect tab UI using subsonic.ts/webdav), T032 (speed/position memory/bookmarks).
3. Decide background-audio fallback from spike results.
## Decisions
- Web Audio scheduling (not `<audio>`) for gapless; ≤3 decoded buffers; IndexedDB blobs; Preact 11 needs the px shim in main.tsx.
## Open issues
- iOS background behavior unknown. Studio export on a phone for long EPs may hit memory limits (single clip in RAM, but output blob grows).

## Update: performance/UX overhaul
- See docs/PERFORMANCE.md. New: VirtualList, dsp worker (src/workers, src/audio/dspClient.ts), resilientFetch, lazy screens (src/ui/lazy.tsx), undo toasts (state.notifyUndo), art thumbnails (artworkUrl sm/full), useSheet/useFrame/useClock hooks in ui/common.tsx. Run e2e/bench against `SEAM_BASE=/SEAM/ npx vite preview`.

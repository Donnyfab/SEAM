# HANDOFF (keep short)
## State (2026-11-01)
- Pivoted from native iOS to an iOS-installable PWA (no Xcode / Apple account). Stack and reasoning: ARCHITECTURE.md. Swift prototype kept in `legacy/`.
- Working: import (tags+artwork), library views, playlists, gapless/crossfade playback, Now Playing sheet, Media Session, Studio (arrangements, waveform trims, per-transition crossfade, preview, WAV mix export, tracklist/JSON), PWA install + offline shell. 117 unit tests; WAV export and gapless timing verified in browser.
- NOT verified: anything on a real iPhone (background audio, memory, FLAC/ALAC decode, storage persistence). `/spike.html` is the test page.
- Codex: bundled CLI (ChatGPT app), logged in. T020 (loudness) and T021 (Subsonic client) merged; effects chain + normalization wired in. Use `scripts/codex-delegate.sh`.
## Next
1. Owner: approve deploy (GitHub Pages public repo vs Cloudflare), then run /spike.html on iPhone (Safari tab + Home Screen) and paste the log.
2. Start T022 (WebDAV client, Codex), T031 (Connect tab UI using subsonic.ts/webdav), T032 (speed/position memory/bookmarks).
3. Decide background-audio fallback from spike results.
## Decisions
- Web Audio scheduling (not `<audio>`) for gapless; ≤3 decoded buffers; IndexedDB blobs; Preact 11 needs the px shim in main.tsx.
## Open issues
- iOS background behavior unknown. Studio export on a phone for long EPs may hit memory limits (single clip in RAM, but output blob grows).

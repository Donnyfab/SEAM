# TESTING
- `npm test` (Vitest): core (crossfade/arrangement/queue), envelope, library model, WAV/peaks, loudness, Subsonic as they land.
- `npm run typecheck`, `npm run build`.
- Browser-verified (Chromium engine via preview): import + tag parse + IndexedDB; gapless chain (0 ms gap between scheduled voices); crossfade gain power constant (RMS 0.2519 vs 0.2525); renderMix output length exact (3,072,000 frames) and valid WAV header; service worker + manifest active; mobile layout screenshots.
- NOT yet verified: real iOS Safari / installed PWA (use /spike.html), long-track memory, FLAC/ALAC decode, lock-screen controls.
- Playwright WebKit is a desktop approximation of Safari and is not a substitute for the iPhone test.

## Phase 5
- Browser-verified: audiobook import (>1 h classified as audiobook), streaming, seek, 1.5x, bookmark, saved + resumed position; backup, delete, restore round trip (blob sizes equal, bookmarks kept, bad file rejected); WebDAV list/stream/download vs a local mock server; passcode verify + lockout schedule.
- Mock-only: Dropbox, Google Drive, OneDrive, Jellyfin, Subsonic, Last.fm.
- Not yet on iPhone: Connect, audiobooks, backup, passcode.

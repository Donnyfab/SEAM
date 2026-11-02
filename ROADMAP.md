# ROADMAP — Evermusic-inspired feature matrix for an iOS PWA
✅ working & tested · 🟡 partly · ⬜ planned · 🔑 needs your credentials/registration · ⚠ browser workaround · ❌ impossible in a PWA

## Playback
- ✅ MP3, AAC, M4A, ALAC, WAV, AIFF, FLAC (whatever Safari's CoreAudio decodes) · ⚠ OGG/Opus/WMA/APE need WASM decoders (⬜)
- ✅ Gapless (sample-accurate scheduling; 0 ms gap measured in desktop Chromium — iPhone not yet tested) · ✅ crossfade 0–15 s, equal-power/linear
- ✅ Repeat/shuffle, queue list, seek, prev/next · 🟡 Lock-screen/headphone controls via Media Session (implemented; iOS behavior unverified)
- ✅ 10-band EQ + 8 presets + preamp/auto-headroom, reverb, delay, distortion, compressor (Settings → Sound) · ✅ loudness normalization (EBU R128 LUFS, target selectable) · ⬜ playback speed + position memory · ⬜ visualizer (AnalyserNode) · ⬜ spatial (basic HRTF panner only)
- ⚠ Background playback: unverified on iOS — run /spike.html (see ARCHITECTURE risks)
- ⚠ AirPlay: system output routing works via Control Center; no in-app picker for Web Audio
## Library
- ✅ Import from Files/iCloud Drive/USB via the iOS file picker (copies into app storage) · ❌ linking a folder in place
- ✅ Songs, albums, artists, genres, favorites, recents, unplayed, search, sort · ✅ playlists (create, rename, reorder, delete)
- ✅ Embedded tags + artwork read · ⬜ bookmarks, lyrics, comments, audiobook mode · ⚠ tag *writing*: store overrides in DB (non-destructive), JS tag writers only for MP3/M4A later
- ⬜ Backup/restore (export/import JSON + files), ⬜ passcode (app-level lock), ⬜ localization, accessibility pass
## EP Transition Studio (priority)
- ✅ Arrangements (multiple, duplicate, compare), ✅ per-transition crossfade + curve, ✅ non-destructive trims + fades, ✅ waveform + drag handles, ✅ suggested start/end points, ✅ preview a join, ✅ play whole sequence
- ✅ Export continuous WAV mix (16-bit, frame-accurate, memory-bounded) · ✅ tracklist (.txt) + arrangement JSON
- ⬜ 24-bit/32f export option in UI, ⬜ M4A export (MediaRecorder/WebCodecs), ⬜ A/B level-matched compare, ⬜ Ableton: import WAV/AIFF/FLAC/MP3 bounces (works now); `.als` project import ❌
## Cloud & network
- ⬜🔑 Dropbox / Google Drive / OneDrive (OAuth PKCE; you register a free app) · ⬜ WebDAV, 🟡 Subsonic/Navidrome (client + tests done, UI pending), ⬜ Jellyfin (server must allow CORS) · ⬜ internet radio/stream URLs (CORS limits metadata)
- ❌ SMB, SFTP, FTP, DLNA/UPnP (no raw sockets in browsers) → use WebDAV/Subsonic gateways on your NAS · ❌ Wi-Fi Drive server on the phone → use Files import
## Platform
- ✅ Installable PWA (manifest + service worker, offline shell) · ⬜ deploy (needs your approval)
- ❌ Home Screen/Lock Screen widgets, ❌ CarPlay app UI (audio continues to car via Bluetooth/USB; Now Playing shows in CarPlay through Media Session)
- ⬜ Last.fm (🔑 API key; CORS to verify)
- ⚠ iOS may evict storage for non-installed PWAs; install to Home Screen + `persist()`

# ROADMAP — Evermusic-inspired feature matrix for an iOS PWA
✅ working & tested · 🟡 partly · ⬜ planned · 🔑 needs your credentials/registration · ⚠ browser workaround · ❌ impossible in a PWA

## Playback
- ✅ MP3, AAC, M4A, ALAC, WAV, AIFF, FLAC (whatever Safari's CoreAudio decodes) · ⚠ OGG/Opus/WMA/APE need WASM decoders (⬜)
- ✅ Gapless (sample-accurate scheduling; 0 ms gap measured in desktop Chromium — iPhone not yet tested) · ✅ crossfade 0–15 s, equal-power/linear
- ✅ Repeat/shuffle, queue list, seek, prev/next · 🟡 Lock-screen/headphone controls via Media Session (implemented; iOS behavior unverified)
- ✅ 10-band EQ + 8 presets + preamp/auto-headroom, reverb, delay, distortion, compressor (Settings → Sound) · ✅ loudness normalization (EBU R128 LUFS, target selectable) · ✅ visualizer (bars/waveform/radial) · ✅ position memory (audiobooks + tracks >10 min) · 🟡 speed 0.5–3× with natural pitch for audiobooks/long files (media element); ❌ pitch-preserving speed for gapless music (Web Audio has no time-stretch) · ⬜ spatial (basic HRTF panner only)
- ⚠ Background playback: unverified on iOS — run /spike.html (see ARCHITECTURE risks)
- ⚠ AirPlay: system output routing works via Control Center; no in-app picker for Web Audio
## Library
- ✅ Import from Files/iCloud Drive/USB via the iOS file picker (copies into app storage) · ❌ linking a folder in place
- ✅ Songs, albums, artists, genres, favorites, recents, unplayed, search, sort · ✅ playlists (create, rename, reorder, delete)
- ✅ Tags, artwork, lyrics, comments read · ✅ edit info/artwork/lyrics (stored in SEAM; original file untouched) · ✅ bookmarks · ✅ audiobooks (.m4b, >1 h, or set manually): streaming player, skip, 0.5–3× speed, sleep timer, resume · ✅ export a copy with tags written (MP3, FLAC, M4A) · ✅ M4A tag writing
- ✅ Backup/restore (.seambak with audio + artwork; keep/replace) · ✅ passcode (PBKDF2 + lockout; a convenience lock, not encryption) · ✅ text size, reduce motion, high contrast, labelled controls · 🟡 localization en/es/fr/de (T050 in progress)
## EP Transition Studio (priority)
- ✅ Arrangements (multiple, duplicate, compare), ✅ per-transition crossfade + curve, ✅ non-destructive trims + fades, ✅ waveform + drag handles, ✅ suggested start/end points, ✅ preview a join, ✅ play whole sequence
- ✅ Export continuous WAV mix (16-bit, frame-accurate, memory-bounded) · ✅ tracklist (.txt) + arrangement JSON
- ⬜ 24-bit/32f export option in UI, ⬜ M4A export (MediaRecorder/WebCodecs), ⬜ A/B level-matched compare, ⬜ Ableton: import WAV/AIFF/FLAC/MP3 bounces (works now); `.als` project import ❌
## Cloud & network
- ✅ Connect tab: WebDAV (verified end-to-end vs a local server), Subsonic/Navidrome, Jellyfin, internet radio (+ .m3u/.pls import); browse, search, stream, ⤓ download for offline · 🟡🔑 Dropbox / Google Drive / OneDrive: OAuth PKCE built and mock-tested; needs your own free app registrations, not yet tried against the real services · ⚠ servers need https:// + CORS · ❌ live radio song titles (ICY metadata unreadable from browsers)
- ❌ SMB, SFTP, FTP, DLNA/UPnP (no raw sockets in browsers) → use WebDAV/Subsonic gateways on your NAS · ❌ Wi-Fi Drive server on the phone → use Files import
## Platform
- ✅ Installable PWA (manifest + service worker, offline shell) · ⬜ deploy (needs your approval)
- ❌ Home Screen/Lock Screen widgets, ❌ CarPlay app UI (audio continues to car via Bluetooth/USB; Now Playing shows in CarPlay through Media Session)
- 🟡🔑 Last.fm: client, scrobble rules and offline queue built and mock-tested; needs your API key; browser access to ws.audioscrobbler.com unverified
- ⚠ iOS may evict storage for non-installed PWAs; install to Home Screen + `persist()`

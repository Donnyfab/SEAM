# ROADMAP — feature parity checklist
Legend: [x] working+tested · [~] logic only, no UI/audio yet · [ ] todo · ⚠ needs credentials/entitlement/cost/limit
Derived from the 13 Evermusic screenshots (Lists, Library, Connect, Files, Settings) and your spec. Official Evermusic docs not yet fetched — verify before claiming parity.

## Screens seen in screenshots -> SEAM equivalents
Tabs: Lists (playlists + search/play/shuffle) · Library · Connect · Files · Settings; mini-player bar with prev/play/next.
Library rows: Favorites, Recents, Bookmarks, Songs, Unplayed songs, Albums, Album artists, Artists, Genres, Composers, Playlists, Local files, Online files; "iTunes music" tab.
Connect: Quick access (Favorites/Recents), Cloud storage, Local network devices, Online links, Computer via Wi-Fi; how-tos (iCloud, Wi-Fi, Mac cable, SMB, Windows, DLNA, Synology, WDMyCloud, WebDAV NAS, USB).
Files: Documents, Downloads, Offline folders, iCloud, Open files/folders, Connect a folder.
Settings: Audio player, Library, Audio tag editor, CarPlay, Widgets, Visualization, File manager, Wi-Fi Drive, Last.fm, Backup & restore, Passcode, Personalization, Accessibility, Window, Language, Help, Legal.

## Phase 1 — foundation (in progress)
- [x] Repo, AGENTS/TASKS/HANDOFF/TESTING docs, Codex delegation script
- [x] SEAMCore: crossfade curves, Arrangement/Clip (nondestructive trim), tracklist export, PlayQueue (repeat/shuffle/reorder)
- [ ] ⚠ Xcode install -> iOS app target (blocks everything below that touches UI/audio)
## Phase 2 — local playback
- [ ] Import from Files/iCloud Drive (UIDocumentPicker, security-scoped bookmarks) · [ ] metadata scan · [ ] library views · [ ] playlists CRUD/reorder
- [ ] AVAudioEngine playback MP3/AAC/M4A/WAV/AIFF/ALAC · ⚠ FLAC decodes natively on iOS via AVAudioFile; OGG/Opus/APE/WMA need a third-party decoder (not planned)
- [ ] Gapless + crossfade 0–15 s · [ ] background audio, Now Playing/remote commands, AirPlay · [ ] speed + position memory · [ ] favorites/bookmarks/recents/unplayed
## Phase 3 — EP Transition Studio, DSP, tags
- [~] Arrangement model, per-transition crossfade, trim, tracklist text · [ ] waveform peaks + view · [ ] transition-point detection · [ ] multiple saved arrangements + compare · [ ] offline mix render (WAV/M4A) · [ ] JSON export
- [ ] EQ + presets, reverb, delay, distortion, compressor (AVAudioUnit*) · [ ] volume normalization (ReplayGain/EBU R128) · [ ] spatial (⚠ AirPods head tracking is system-controlled)
- [ ] tag editor ⚠ AVFoundation can't write ID3/FLAC tags; needs a tag-writing library (dependency approval) or sidecar metadata
- [ ] lyrics, artwork, comments
## Phase 4 — cloud & network
- [ ] iCloud Drive / Files provider (no credentials) · [ ] folder bookmarks, offline folders, downloads
- ⚠ Google Drive / Dropbox / OneDrive: need your own OAuth app registrations (free tiers) · [ ] WebDAV (URLSession, feasible) · [ ] SMB/SFTP/FTP: need third-party libs (approval)
- ⚠ DLNA/UPnP: SSDP multicast needs `com.apple.developer.networking.multicast` entitlement (Apple request) · [ ] Subsonic/Navidrome/Jellyfin/Plex APIs (your server) · [ ] Wi-Fi transfer server · [ ] internet radio/stream links
## Phase 5 — extras
- ⚠ CarPlay audio: needs Apple-granted CarPlay entitlement (request form; not available to free accounts by default)
- [ ] Widgets (WidgetKit) · [ ] Last.fm (⚠ your API key) · [ ] audiobooks + bookmarks · [ ] visualizer · [ ] backup/restore · [ ] passcode · [ ] accessibility, localization, appearance
## Phase 6 — release
- [ ] Tests, perf, security review · ⚠ install on iPhone: free Apple ID provisioning expires every 7 days; $99/yr program avoids it

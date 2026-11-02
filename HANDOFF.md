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

## Update: Apple Music-style playlist detail + floating tab bar (2026-11-02)
- Playlist detail (`PlaylistDetail` in `src/ui/Playlists.tsx`) now has a full-bleed hero, glass nav (back; share = export menu; more = existing menu), shuffle / Play / search row, 64px rows with thumbnails and a "N songs, M minutes" footer. Styles are `pd-*` (and `.song-row`) at the end of `styles.css`; the detail sets `--bg: #0a0d12` via `html.pd-on` while mounted.
- The existing bottom tab bar is now the floating glass pill (accent #ff375f, `--tab-h` is 88px so the mini player/action bar sit above it) with a `.tab-fade` gradient.
- Removed: artwork-reactive glass on the detail (`glass-page`, `detail-hero`, `playlistPalette`, `Cover big`); the detail's Play-next button (still in the More menu). Now Playing still uses `useGlow`.
- e2e/a11y/bench/shots scripts updated to the new selectors; e2e 21/21.

## Done: T074 playlist/navigation fixes (2026-11-02)
- Branch `codex/t074-playlist-navigation`, ready for Claude to merge. GitHub main and the playlist redesign branch both matched local base `fc2af70` when checked.
- Replaced the floating pill with a 56px bottom-docked tab bar plus the device safe area; corrected mini-player spacing, selection-toolbar overlap, narrow search fields and double-counted header safe area. Replaced the emoji Next icon with SVG.
- Reproduced Add songs at 4,301px tall on a 390×844 viewport. Portaled playlist sheets and glass overlays outside page animations; removed persistent page transform/stacking effects. Picker now measures 390×844 and virtualizes against its own sheet scroller, including deep scrolling through 3,000 songs.
- Fixed one-tap Now Playing Close (the drag handler previously captured the button's tap); added drag threshold, cancellation and timer cleanup. Backdrop pointer state is isolated and cancelled safely.
- Closing search clears its filter; empty search results disable playback. Rearrange switches grid to rows. Custom artwork replacement refreshes immediately; Add songs counts only new entries.
- Verification: `npm test` 509/509, `npm run typecheck`, `npm run build`, `npm run e2e -- http://127.0.0.1:4183/` 29/29; a11y script reports 0 issues. Tested Chromium touch at 320×568, 390×844, 440×956, 844×390 and 1280×800 with simulated top/bottom safe areas. Screenshots inspected; no framework overlay or page/console errors. Browser plugin absent; used the existing Playwright workflow without adding dependencies. Real iPhone Safari/PWA and keyboard/background-audio behavior remain unverified. Existing Book.tsx static/dynamic import build warning remains.
- Not merged, pushed or deployed; owner/Claude retains merge ownership.

## Done: T075 compact visual scale (2026-11-02)
- Branch `codex/t075-compact-design` is based on T074 (`e80529d`) and includes its interaction/navigation fixes. Ready for Claude to merge; not pushed or deployed.
- Kept the existing Preact/CSS design system and SF/system font. Base type is 16px with the saved text-scale multiplier; large headings 28px, playlist title 22px, song title 15px, artist 12px. Artists now sit below song titles; duration is a quiet trailing column.
- Playlist rows and virtual library/picker rows are 56px instead of 64px; thumbnails 40px instead of 48px. Detail rows expand with text scale. Header artwork is 200–260px plus safe area, with a compact 140px header when artwork is absent. Mini player is 52px instead of 60px, with a 740px desktop width limit; dock is 52px plus safe area. Visual icon surfaces are smaller while hit targets stay at least 44px. Now Playing artwork is capped at 240px instead of 300px; softened shadows and reduced control sizes.
- Reference comparison: inspected both owner-supplied JPGs in Downloads with the final rendered screenshots. Checked (1) title/body/caption hierarchy, (2) artwork-to-song balance, (3) row/thumbnail density and artist placement, (4) white Play pill and smaller surrounding controls, (5) thin separators/subtle glass, (6) compact player/dock and safe areas. No extra visible copy or decorative labels; artist content comes from the library. Intentional differences: SEAM's five functional tabs, dark shell and imported artwork remain product-specific; these framed/perspective references are visual direction rather than exact pixel-size app screenshots.
- Verified locally in IAB (creation/list/detail) and production Playwright at 320×568, 390×844, 440×956, 844×390 and 1280×800, including simulated safe areas, artwork replacement and 140% type. At 390×844 with artwork and iPhone safe areas, six full song rows fit above the mini player. Inspected mobile/detail/picker/player/desktop screenshots; page identity SEAM, no blank screen, framework overlay or page/console errors. QA screenshots and test scripts remain outside the repo in `/tmp/seam-t075-*`.
- Checks: 509 unit tests, typecheck, production build, 31 browser checks and accessibility script (0 issues). Existing Book.tsx static/dynamic import warning remains. Native iPhone Safari/PWA, keyboard and background audio still need physical-device verification.

## Deployment handoff (2026-11-02)
- Pushed `codex/t075-compact-design` and opened https://github.com/Donnyfab/SEAM/pull/1 with both T074 and T075. PR is mergeable; a `/SEAM/` production build also passed.
- Live GitHub Pages is still the successful `fc2af70` deployment (run 41485203609). Phone users will not receive the fixes until PR #1 merges to `main` and the Pages workflow succeeds.
- `AGENTS.md` says "Claude merges." Merge ownership is the remaining step; requested an owner override before Codex merges/deploys.

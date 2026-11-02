# Performance & UX overhaul (2026-11-02)

## How it was measured
`scripts/bench.mjs` drives the production build in headless Chromium: 390x844 phone viewport, **4x CPU throttling** (to approximate a mid-range phone), a seeded library of **3,000 songs and 40 playlists**, service worker disabled. Baseline = the commit before this work, built and served the same way; results below are two runs each.
Also: `scripts/e2e.mjs` (14 end-to-end checks), `scripts/a11y.mjs` (accessibility audit), `scripts/profile.mjs` (CPU profile of one interaction). Run with the app served by `SEAM_BASE=/SEAM/ npx vite preview --port 4182`.

## Problems found
1. **Whole-library lists rendered in full.** Opening Songs built 24,052 DOM nodes (3,000 rows x nested elements) and re-built them on every play-count update.
2. **Loudness analysis ran on the main thread after every first play** (it was measured even with normalization off): a ~2 s freeze on a 70-minute file in testing; seconds on a phone for a normal track.
3. **Playback re-rendered the UI every animation frame** (mini-player, Now Playing including the whole queue list).
4. **Waveform analysis in Studio ran on the main thread.**
5. **Everything shipped in one 396 KB script** (all screens, 4 languages, cloud/Last.fm clients, tag writers).
6. Search re-normalised every field of every song on every keystroke, with no debounce; each artwork row read a full 512 px image from IndexedDB; playlist covers issued 13 image reads each.
7. UX gaps: destructive actions had no undo, errors blanked the screen, scroll position and form drafts were lost, no offline indication, many controls below 44 px, sheets without focus handling or swipe-to-dismiss.

## Results (4x CPU throttle, 3,000 songs)
| Measure | Before | After |
|---|---|---|
| Open Songs list | 940-956 ms | 67-69 ms |
| DOM nodes on Songs screen | 24,052 | 269 |
| Search, first keystroke | 205-242 ms | 26-48 ms |
| Tap song -> playing | 761-763 ms | 189-217 ms |
| Frames rendered in 4 s of playback (Now Playing open) | 151-152 (~38 fps) | 241 (~60 fps) |
| Playback frame p95 | 30.5-32 ms | 22.1-22.9 ms |
| Long tasks during playback | 2 | 0 |
| Open Settings | 215-218 ms | 73-77 ms |
| Open Library tab | 127-145 ms | 112-119 ms (first open loads a 21 KB chunk, pre-fetched when idle) |
| Scroll p95 over 3,000 songs | 18.3-23 ms | 18.3-18.5 ms (worst frame 31.5 -> 19.2 ms in the earlier run) |
| App ready (data loaded) | 120 ms | 120-133 ms (unchanged) |
| Initial JavaScript | 396 KB (117 KB gzip), 1 file | ~150 KB (~45 KB gzip) across entry + shared chunks; screens, other languages, cloud/Last.fm, importer load on demand |
| Layout shift (CLS) | 0 | 0 |

Not improved: opening a playlist (about 30 ms before and after), app-ready time. LCP/INP/FPS are lab numbers from a desktop machine with CPU throttling, not field data from a phone.

## What changed
- **Virtual lists** for Songs, Albums/Artists/Genres and both song pickers (`VirtualList`, pure windowing maths tested); `content-visibility` on cards/rows.
- **Workers**: loudness (only when normalization is on, on a <=2 min excerpt) and Studio waveform analysis run in `dsp.worker`, with a main-thread fallback.
- **Rendering**: playback progress and scrubber are written straight to the DOM; only the clock text re-renders (4 Hz); queue list no longer re-renders per frame.
- **Loading**: code-split screens with skeletons and idle/hover prefetch, English-only first bundle with languages on demand, importer/cloud/Last.fm lazy, `storage.persist()` no longer blocks startup, engine not created by opening Settings.
- **Data**: 160 px artwork thumbnails (generated once, cached), IntersectionObserver-deferred playlist covers, cached search index per song, 120 ms debounce, concurrency-limited image reads, save retry + visible error on persistent write failure, orphaned file cleanup.
- **Network**: timeouts, bounded retries with backoff for safe requests, offline detection (`resilientFetch`).
- **Interaction**: undo for deleting songs, playlists and playlist entries; drafts kept for the song editor and connection forms; selected tab, tab scroll position and playlist-list scroll restored; edge-swipe back; swipe-down to dismiss Now Playing / audiobook sheets; focus moves into and back out of sheets, Escape closes; tapping the active tab scrolls to top; immediate pressed states on all buttons; loading spinner in the mini-player.
- **Reliability**: error boundary per screen with "Try again / Reload", offline banner, unhandled-rejection logging, i18n guard test for plural keys.
- **Accessibility**: one `h1` per screen, labelled `main`/`nav`, `aria-modal` dialogs, `aria-pressed` toggles, all controls >= 44 px, reduced-motion media query plus in-app setting.

## Remaining limitations (honest list)
- **No iPhone testing was done.** Numbers are throttled desktop Chromium; real Safari/iOS timing, memory pressure and haptics are unverified. Edge-swipe and sheet-drag gestures were not exercised on touch hardware.
- No Lighthouse / WebPageTest / field INP; INP is approximated by time-to-next-frame after input.
- The accessibility audit is a custom rule set (names, targets, headings, landmarks, contrast in light and dark), not a full WCAG 2.2 AA review or screen-reader test (VoiceOver not tried).
- Decoding a track still happens fully in memory before playback starts (Web Audio limitation); very long tracks stream through the audiobook player instead.
- Studio export still renders on the main-thread OfflineAudioContext pipeline (the heavy rendering itself is native), and its decode is sequential.

# ARCHITECTURE (PWA)

## Decision: TypeScript PWA, Web Audio engine, IndexedDB storage
Why not native: Xcode + Apple account were ruled out. A PWA installs from Safari, updates by redeploy, and costs $0.

| Concern | Choice | Why / rejected alternatives |
|---|---|---|
| Language/build | TypeScript (strict), Vite | Fast, tiny output, first-class PWA plugin. Rejected: Next/Nuxt (SSR irrelevant), Flutter web (large, poor audio control). |
| UI | Preact + @preact/signals, hand-written CSS | 4 KB runtime, ~176 KB total JS. iOS look needs custom CSS anyway. Rejected: React (size), Svelte (fine, but no gain), UI kits (generic look). |
| Audio | Web Audio API: `AudioBufferSourceNode` scheduled on the audio clock | The only web API with sample-accurate gapless + crossfade. `<audio>` elements cannot do gapless. |
| Decoding | `decodeAudioData` (CoreAudio in Safari): MP3, AAC, M4A, ALAC, WAV, AIFF, FLAC | No WASM decoders shipped yet. OGG/Opus/WMA: later via WASM if needed. |
| Tags/artwork | `music-metadata` (parseBlob) | Reads ID3, MP4, FLAC, Vorbis, artwork. ~30 KB gz, lazy-loaded parsers. |
| Storage | IndexedDB via `idb-keyval` (audio Blobs, artwork thumbs, metadata, playlists, arrangements) + `navigator.storage.persist()` | Blobs are disk-backed. Rejected: OPFS (more code, Safari write-API gaps) — revisit if quota/perf demands. |
| Offline | `vite-plugin-pwa` (Workbox precache of the app shell) | Music lives in IndexedDB, so playback needs no network or server. |
| Tests | Vitest (pure logic, node) + in-browser verification scripts | |
| Hosting | GitHub Pages (workflow included) or Cloudflare Pages | $0, HTTPS required for service workers/install. |

## Layers
- `src/core` — pure logic: crossfade curves, Arrangement/Clip (non-destructive trims, per-transition crossfade), queue. (Ported 1:1 from the earlier Swift prototype, now in `legacy/`.)
- `src/audio` — `engine.ts` (gapless/crossfade scheduler, Media Session), `envelope.ts` (pure gain envelopes), `render.ts` (offline mix export, one clip in memory at a time), `wav.ts`/`peaks.ts` (Codex: encoder, waveform peaks, transition detection).
- `src/library` — model (search/sort/group), IndexedDB store, importer.
- `src/studio` — analysis cache (peaks only, PCM discarded) and arrangement playback.
- `src/ui` — screens. `src/state.ts` — signals, decode LRU (≤3 buffers), engine singleton.

## Audio engine design
Each clip becomes a `Voice`: source → per-voice gain (sampled envelope via `setValueCurveAtTime`) → master. The next voice is scheduled at `end − overlap` on `ctx.currentTime`, so joins do not depend on JS timers. The following track is only decoded after the previous voice ends (≤ ~3 decoded buffers live). Pause = `ctx.suspend()`, so scheduled starts freeze consistently. Seek = rebuild the chain at an offset.

## Key risks (verify on the iPhone with /spike.html)
1. Does Web Audio keep playing with the screen locked / app switched, and for how long are scheduled voices honored if JS is frozen?
2. Memory: decoded float32 ≈ 100 MB per 5-min stereo track at 44.1 kHz; iOS may kill the PWA.
3. Storage eviction of installed vs. tab PWAs; `persist()` result.
4. Silent switch / `navigator.audioSession`.
Results decide whether a hidden `<audio>` keep-alive element is added (not added blind).

## Claude–Codex workflow
`scripts/codex-delegate.sh <id> "<task>"`: creates worktree `../SEAM-wt/<id>` on `codex/<id>`, runs `npm ci` (Codex's sandbox has no network), runs `codex exec --sandbox workspace-write` with AGENTS.md + one bounded task, commits its result (Codex can't write the git index), appends to HANDOFF.md on failure/usage-limit. Claude reviews and merges. State lives in git + markdown, so either agent can resume without the other's session.

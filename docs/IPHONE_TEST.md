# iPhone test checklist (10 minutes)
Needs the deployed HTTPS URL (service workers and Home Screen install don't work over a plain LAN address).

## A. /spike.html (run twice: Safari tab, then Home Screen app)
1. Environment → Copy results later. 2. Pick one MP3, M4A, FLAC, ALAC and 24-bit WAV → "Decode each file".
3. Gapless buttons (listen at the join) and crossfade. 4. Start the 3-min background tone, lock the phone ~40 s, unlock, read the log.
5. Suspend test: lock the phone, press Play on the lock screen. 6. Tap "Copy results" and send them over.

## B. The app (Share → Add to Home Screen)
- Files → import one MP3 and one FLAC → songs appear with artwork.
- Force-quit, reopen: songs persist and play (offline too: airplane mode).
- Play an album, crossfade off: listen at the joins.
- Lock mid-track: does the next track start? Do lock-screen buttons work?
- Studio: build a 3-track EP, preview a join, export the WAV.

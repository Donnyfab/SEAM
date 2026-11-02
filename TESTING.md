# TESTING
- Unit: `scripts/test-clt.sh` (CLT-only) or `swift test` (Xcode). Currently 16 tests: crossfade curves, arrangement timeline/trim/reorder/export, play queue.
- Not yet verifiable (needs Xcode): iOS build, simulator UI, AVAudioEngine gapless/crossfade timing, CarPlay, widgets, device install.
- Audio-timing tests plan: render known tones through the engine offline (manual rendering mode) and assert sample-accurate overlap.
## Known issues
- `swift test` on bare CLT needs the flags in scripts/test-clt.sh (Testing.framework paths are not default).

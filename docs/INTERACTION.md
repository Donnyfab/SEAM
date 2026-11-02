# Interaction conventions

All overlays (glass menus, action sheets, dialogs, full-screen sheets, the legacy action menu) share `src/ui/overlay.ts`:

- **One stack.** Only the topmost overlay reacts to Escape, Tab and arrow keys. A submenu's Escape steps back before it closes.
- **Focus.** Focus moves in on open (menus: first item; danger confirms: Cancel; text dialogs: the input) and returns to the opener on close. Tab is trapped inside.
- **Dismissal.** A backdrop press closes only if it both starts and ends on the backdrop. A text dialog with typed input ignores backdrop taps; Escape and Cancel always work.
- **Single settle.** Dialogs resolve once, so double Enter or double taps cannot run an action twice.
- **Gestures.** The edge-swipe back gesture is ignored while an overlay is open.
- Native `prompt()`/`confirm()` were replaced by the glass dialogs everywhere.

Checked by `npm run e2e` (headless Chromium, keyboard and pointer). Not checked: real iPhone touch behaviour, VoiceOver, the Android/browser Back button (overlays do not push history entries, so Back leaves the screen rather than closing an overlay).

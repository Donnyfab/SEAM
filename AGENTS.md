# SEAM — shared agent instructions (Claude + Codex)

SEAM is a personal, free music player + "EP Transition Studio" built as an iOS-installable PWA (TypeScript, Vite, Preact, Web Audio). The old Swift prototype is in legacy/ (reference only).
Read HANDOFF.md first, then only the task you were assigned in TASKS.md. Do not re-read the whole repo.

## Rules
- One task = one branch/worktree (`claude/<task-id>` or `codex/<task-id>`). Never edit files outside your task's listed paths.
- Pure logic (no DOM) goes in `src/core`, `src/library`, `src/audio/*.ts` pure functions; testable with Vitest in node. DOM/UI code lives in `src/ui`.
- Every change ships with tests. Run `npm test` and `npm run typecheck` before handing back.
- TypeScript strict. No `any`. Pure functions over typed arrays; no hidden globals. No third-party deps without owner approval.
- Do not add npm dependencies. Never write secrets/API keys to the repo. Never run destructive git/file commands without owner approval.
- No placeholder buttons: a feature is either working and tested, or absent and listed in ROADMAP.md as not done.
- When finished: update TASKS.md status, append to HANDOFF.md "Done", commit and push your task branch, merge the pull request into main, and verify the GitHub Pages deployment and live site. The owner has authorized agents to merge and deploy completed changes without asking again (2026-11-02). This replaces the previous "Claude merges" rule.

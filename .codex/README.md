# Quest Forge Codex Notes

This folder keeps project-local Codex context that is useful across sessions.

## Project Shape

Quest Forge is a Vite + React tabletop RPG client. It uses:

- `src/state/gameReducer.js` for canonical game state changes.
- `src/state/persistence.js` for local IndexedDB saves and settings in `localStorage`.
- `src/state/cloudSync.js` for Firestore saves at `users/{uid}/saves/{slotId}`.
- `src/config/firebase.js` for user-provided Firebase app/auth setup.
- `src/engine/rules.js` and `src/engine/characterUtils.js` for simplified D&D-style math.
- `src/data/classes.js` and `src/data/races.js` for character options.

## Useful Commands

Use `npm.cmd` on Windows PowerShell to avoid execution policy issues with `npm.ps1`.

```powershell
npm.cmd install
npm.cmd run build
npx.cmd eslint src\path\to\file.jsx
npx.cmd firebase deploy --only hosting --project quest-forge-99ab1
```

## Current Hosting

Firebase project: `quest-forge-99ab1`

Hosting URL: `https://quest-forge-99ab1.web.app`

## Cloud Sync Notes

The current signed-in Firebase user and current settings should survive save loads. Avoid replacing them from saved payloads in `LOAD_GAME`; older local saves may contain stale or missing auth/settings data.

Manual saves and autosaves write to Firestore only when `state.user.uid` is present and Firebase is initialized.

## Local Agent

`agents/rpg-balance-master.toml` is a project-specific RPG mechanics reviewer. It is useful for class, race, AC, equipment, combat, and balance changes.

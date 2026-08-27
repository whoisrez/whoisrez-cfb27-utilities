# v0.1.21 — Packaged Startup Fix

This update fixes a Windows portable-build startup issue found immediately after the first public beta release.

## Fixed

- Fixed a packaged Windows startup hang that could leave the app on a black screen before the renderer loaded
- Removed the redundant post-creation window icon call that caused the packaged app to stall
- Uses the packaged Electron Forge renderer path directly for production startup
- Removed temporary startup diagnostics used to isolate the issue

## Included from the first public beta

- Five fixed promotion/relegation pairings plus a manual Independent flex pool
- Automatic Tier 2 champion promotion
- Tier 1 relegation based on conference record, overall record, then head-to-head when available
- Manual tiebreaks and manual overrides
- Two-completed-season movement cooldown
- Multi-season history with reopen/edit support
- Current Alignment, Teams, Conferences, and season History views
- Same-season Sync failsafe that preserves the original offseason review snapshot
- Post-change alignment verification against the latest synced game save
- Portable Windows build with local tracker-history storage

## Important

- Windows only
- Requires a CFB 27 PC dynasty save
- Read-only with respect to CFB 27 save files
- The portable build is currently unsigned, so Windows SmartScreen may display a warning
- Back up the `data` folder beside the executable if moving the tracker to another computer

This is an unofficial community project and is not affiliated with, endorsed by, or sponsored by Electronic Arts or EA Sports.

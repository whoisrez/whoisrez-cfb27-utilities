# Changelog

## Unreleased

- Rebuilt the interface code as one app instead of a base page plus a dozen scripts that re-drew it after loading. Pages now appear complete right away, without the brief flash of older text after importing or syncing.
- Error messages for a failed import, sync, or season close now stay visible instead of being overwritten.
- Removed the unfinished save-writer and "Compare Manual Move" debug tools.
- Organized source into `main/`, `renderer/`, `shared/`, and `styles/`; removed old build scripts and unused files.
- Added a CI check (typecheck + package build) for pull requests.

## v0.1.1

- Replaces the previous Windows app icon with the new CFB 27 Utilities question-mark football badge.
- Adds the integrated `27` mark and `by whoisrez` branding to the app icon.
- Uses the new icon for both development windows and packaged portable builds.

## v0.1.0

- First public release of CFB 27 Utilities.
- Combines Team Needs and Promotion / Relegation in one desktop app.
- Uses one shared dynasty import with separate Team Needs and Offseason sync actions.
- Reads the user-controlled team's recruiting board for committed/signed recruits.
- Preserves Promotion / Relegation season history, cooldowns, manual overrides, and independent moves.
- Adds persistent user-team logo/name identity in the sidebar.
- Includes the cleaned-up Offseason navigation and larger, easier-to-read interface text.
- Portable Windows build stores persistent app data in the `data` folder beside the executable.

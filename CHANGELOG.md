# Changelog

## v0.2.0

- Adds **Roster → Depth Chart**, a defensive depth chart builder for the user-controlled team.
- Fills every base spot (LEDG, REDG, DT, SAM, MIKE, WILL, CB, FS, SS) with players listed at that position only, so blowout subs never pull a starter to another spot.
- Orders by overall, with position-specific ratings breaking ties within 1 point; short groups borrow spare players from the same unit who are on no other list.
- Builds the sub packages too: RLE/RRE/RDT by pass rush, NT by run fit, SUBLB in MIKE order, and SLCB by slot coverage.
- Shows a current-vs-recommended preview with the reason for every pick, flags players who are currently out of position, and lets you choose which spots to write.
- Writes to a new versioned copy of the save (`<save>-DC-v1`, `-v2`, …) and re-reads it to verify every spot. The original save is never modified.

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

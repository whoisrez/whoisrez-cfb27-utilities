# Changelog

## v0.3.0

- **Depth Chart now covers offense and special teams**, with Defense / Offense / Special Teams tabs.
  - Offense: position-locked QB, HB, FB, WR, TE, LT, LG, C, RG, RT, plus 3DRB (receiving back), PWHB (power back), SLWR (slot receiver) and GAD (gadget).
  - Special teams: K and P back each other up; KOS by kick power; KR and PR from non-starters by return ability; LS is the best Long Snap rating among non-starters.
  - Short position groups borrow a spare from the same unit first, then any unlisted player on that side of the ball.
- Writing can include lists from all three tabs at once; each tab has Select / Skip all.
- **Your current chart wins ties.** A spot only changes when the player there now is out of position, starts somewhere else, or the new pick is clearly better (more than 1 overall, or clearly better ratings for that spot).
- Every change explains why it beats the player your chart has there now.
- **Injuries:** injured players keep their spot (marked OUT), and the next healthy player is shown as the one who plays.
- Tabs are ordered Offense, Defense, Special Teams.
- **Works with every defensive playbook.** Starters per spot follow the scheme stored in the save (4-3, 3-4, 4-2-5, 3-3-5, 3-3-5 Tite, 3-2-6, Multiple), or one picked in settings, and can be set per spot.
- **Customize logic:** edit the rating weights behind all 27 formulas (every spot, package and return role), pick "overall first" or "ratings only", set the tie window and the "clearly better" margin, switch each rule on or off, and apply quick leans (Speed / Strength / Football IQ first). Changes re-rank instantly and are saved; settings can be copied and pasted to share.
- Depth Chart is rebuilt on the new app structure (same rules and save-copy safety as v0.2.0).
- App cleanup:
  - Rebuilt the interface code as one app instead of a base page plus a dozen scripts that re-drew it after loading. Pages now appear complete right away, without the brief flash of older text after importing or syncing.
  - Error messages for a failed import, sync, or season close now stay visible instead of being overwritten.
  - Removed the unfinished conference save-writer and "Compare Manual Move" debug tools.
  - Organized source into `main/`, `renderer/`, `shared/`, and `styles/`; removed old build scripts and unused files.
  - Added a CI check (typecheck + package build) for pull requests.

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

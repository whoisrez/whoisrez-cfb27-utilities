# CFB 27 Utilities

A combined College Football 27 dynasty companion app.

## Current modules

- **Recruiting → Team Needs**
  - reads the user-controlled team's roster
  - tracks graduating, transferring, projected draft, and cut departures
  - auto-reads committed/signed recruits from the user team's recruiting board
  - keeps its own weekly Sync action

- **Season → Promotion / Relegation**
  - tracks the two-tier conference system
  - supports manual promotion/relegation review and history
  - keeps its own Season Sync action

The app uses one shared dynasty import, while each module syncs independently.

## Development

```powershell
npm.cmd install
npm.cmd start
```

## Source history

This repository began from the tested combined build developed from the standalone CFB27 Team Needs and CFB27 Promotion/Relegation projects. Those standalone repositories remain separate.

# CFB 27 Utilities

A portable Windows dynasty companion for **EA Sports College Football 27** that combines roster planning and offseason conference management in one app.

## Download

**Latest release:** [CFB 27 Utilities v0.1.1](https://github.com/whoisrez/whoisrez-cfb27-utilities/releases/latest)

Download **`CFB-27-Utilities-Portable.zip`**, extract it to any writable folder, and run **`CFB 27 Utilities.exe`**.

> Windows may show a SmartScreen warning because the app is not code-signed.

The portable build stores persistent tracker data in the **`data`** folder beside the executable, so the whole extracted folder can be moved together.

## Current modules

### Recruiting → Team Needs

- Reads the **user-controlled team's** roster automatically.
- Tracks graduating, transferring, projected draft, and cut departures.
- Auto-reads committed/signed recruits from the user team's recruiting board.
- Groups positions into the roster targets used by the Team Needs planner.
- Keeps its own **weekly Sync** action so roster/recruiting data can be refreshed without running offseason logic.

### Offseason → Promotion / Relegation

- Tracks the two-tier conference promotion/relegation system.
- Supports the five paired conference paths:
  - ACC ↔ American
  - Big Ten ↔ MAC
  - Big 12 ↔ C-USA
  - Pac-12 ↔ Mountain West
  - SEC ↔ Sun Belt
- Recommends promotions and relegations from the imported dynasty results.
- Supports manual overrides and tiebreak review.
- Tracks movement history and two-year protection/cooldowns.
- Supports movement to/from Independent.
- Includes Dashboard, Promotion / Relegation, Current Alignment, Teams, Conferences, and History views.
- Keeps its own **Offseason Sync** action.

## Shared dynasty workflow

The app uses **one shared dynasty import** for both modules.

After a save is imported:

- the sidebar shows the loaded user team's logo and name;
- Team Needs reads that team's roster and recruiting board;
- Promotion / Relegation reads the same dynasty save for offseason tracking;
- each module can be synced independently when its data actually needs to be refreshed.

The tracker is **read-only by default** and does not automatically overwrite CFB 27 saves.

## Development

For local development on Windows:

```powershell
npm.cmd install
npm.cmd start
```

Development runs use Electron's normal AppData storage. Packaged portable releases use the `data` folder beside the executable.

## Source history

CFB 27 Utilities combines the tested functionality from the standalone **CFB27 Team Needs** and **CFB27 Promotion/Relegation** projects. Those standalone repositories remain separate for reference and standalone use.

## License

MIT License.

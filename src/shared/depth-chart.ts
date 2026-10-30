// Types shared by the depth chart reader/writer (main) and the Depth Chart page (renderer).

export type DcSide = 'offense' | 'defense' | 'special';

export type DcRatings = Record<string, number>;

/** Injury read from the save. Injured players keep their spot; the next healthy player starts. */
export type DcInjury = { status: string; type: string; weeks: number; reserve: boolean };

export type DcPlayer = {
  row: number;
  name: string;
  position: string;
  jersey: number;
  ovr: number;
  archetype: string;
  year: string;
  dev: string;
  weight: number;
  ratings: DcRatings;
  injury: DcInjury | null;
};

export type DcPlayerView = DcPlayer & { displayPosition: string };

export type DcEntry = {
  row: number;
  /** Why this player is in this spot. */
  note: string;
  /** Why this beats what the current chart has here (only when the spot changes). */
  versus?: string;
  /** True when the current chart's choice was kept because the alternative was not clearly better. */
  kept?: boolean;
};

export type DcSlotPlan = {
  key: string;
  label: string;
  help: string;
  side: DcSide;
  kind: 'base' | 'package';
  size: number;
  starters: number;
  /** Positions that belong in this spot; anything else is shown as out of position. */
  positions: string[];
  current: number[];
  recommended: DcEntry[];
  changed: boolean;
};

export type DcPlan = { slots: DcSlotPlan[] };

export type DcTeamOption = { teamIndex: number; teamName: string; isUserControlled: boolean };

export type DepthChartLoad = {
  filePath: string;
  teams: DcTeamOption[];
  teamIndex: number;
  teamName: string;
  players: DcPlayerView[];
  plan: DcPlan;
};

export type DepthChartWriteRequest = {
  teamIndex: number;
  slots: Array<{ key: string; rows: number[] }>;
};

export type DepthChartSaveResult = {
  outputPath: string;
  backupPath: string | null;
  writtenSlots: number;
  writtenEntries: number;
  verifiedSlots: number;
};

/** Bridge exposed by preload.ts as `window.depthChartAPI`. */
export type DepthChartApi = {
  load: (teamIndex?: number | null) => Promise<DepthChartLoad>;
  write: (filePath: string, request: DepthChartWriteRequest) => Promise<DepthChartSaveResult | null>;
};

/** In-game position names for the save's position codes. */
export const DISPLAY_POSITION: Record<string, string> = {
  LE: 'LEDG', RE: 'REDG', DT: 'DT', LOLB: 'SAM', MLB: 'MIKE', ROLB: 'WILL', CB: 'CB', FS: 'FS', SS: 'SS',
  QB: 'QB', HB: 'HB', FB: 'FB', WR: 'WR', TE: 'TE', LT: 'LT', LG: 'LG', C: 'C', RG: 'RG', RT: 'RT', K: 'K', P: 'P',
};

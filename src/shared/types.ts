export type TeamRef = {
  row: number;
  teamIndex: number;
  displayName: string;
  longName: string;
  nickname: string;
  label: string;
};

export type ConferenceRef = { name: string; enum: string };

export type TeamSeason = TeamRef & {
  conference: string | null;
  conferenceEnum: string | null;
  overallWins: number;
  overallLosses: number;
  overallTies: number;
  confWins: number;
  confLosses: number;
  confTies: number;
  conferenceStanding: number;
  cfpRank: number;
  mediaRank: number;
  coachesRank: number;
};

export type GameResult = {
  row: number;
  seasonYear: number;
  seasonWeek: number;
  seasonWeekType: string;
  homeTeamIndex: number | null;
  awayTeamIndex: number | null;
  homeName: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  gameStatus: string;
  isFinal: boolean;
};

export type ConferenceChampion = {
  seasonYear: number;
  conferenceName: string;
  championTeamIndex: number | null;
  championName: string;
  championScore: number;
  championWins: number;
  championLosses: number;
  runnerUpTeamIndex: number | null;
  runnerUpName: string;
  runnerUpScore: number;
};

export type DynastySnapshot = {
  filePath: string;
  dynastyId: string;
  importedAt: string;
  seasonYear: number;
  baseCalendarYear: number;
  currentWeek: number;
  currentWeekType: string;
  currentStage: string;
  teams: TeamSeason[];
  games: GameResult[];
  conferenceChampions: ConferenceChampion[];
};

export type MovementKind = 'promotion' | 'relegation' | 'to-independent' | 'from-independent';
export type MovementMode = 'automatic' | 'manual';

export type Movement = {
  seasonYear: number;
  pairKey: string;
  kind: MovementKind;
  teamIndex: number;
  teamName: string;
  fromConference: string;
  toConference: string;
  mode: MovementMode;
  reason: string;
};

export type StoredSeason = {
  seasonYear: number;
  closed: boolean;
  closedAt: string | null;
  reopenedAt: string | null;
  /** Locked snapshot used for that season's recommendations and permanent history. */
  snapshot: DynastySnapshot;
  /** Most recently synced copy of the same game save, including post-alignment changes. */
  latestSnapshot?: DynastySnapshot;
  /** Set when the first complete offseason review is captured. Closed legacy seasons are implicitly locked. */
  reviewLockedAt?: string | null;
  movements: Movement[];
};

export type DynastyHistory = {
  dynastyId: string;
  label: string;
  savePath: string;
  seasons: StoredSeason[];
};

export type HistoryStore = {
  version: 1;
  dynasties: Record<string, DynastyHistory>;
};

export type TeamNeedsPlayer = {
  position: string;
  schoolYear: string;
  redshirtStatus: string;
};

export type TeamNeedsRecruit = {
  position: string;
  recruitStage: string;
};

export type TeamNeedsTeam = {
  teamName: string;
  teamIndex: number;
  isUserControlled: boolean;
  roster: TeamNeedsPlayer[];
  recruits: TeamNeedsRecruit[];
  recruitingAuto: boolean;
};

export type TeamNeedsDynasty = {
  filePath: string;
  teams: TeamNeedsTeam[];
};

export type TeamBranding = {
  logoUrl: string;
  color: string;
  alternateColor: string;
  displayName: string;
};

/** Bridge exposed by preload.ts as `window.promoAPI`. */
export type PromoApi = {
  chooseAndLoad: () => Promise<DynastySnapshot | null>;
  syncCurrentSave: () => Promise<DynastySnapshot>;
  getLatestSnapshot: () => Promise<DynastySnapshot | null>;
  getHistory: (dynastyId: string) => Promise<DynastyHistory | null>;
  closeSeason: (dynastyId: string, seasonYear: number, movements: Movement[]) => Promise<DynastyHistory>;
  reopenSeason: (dynastyId: string, seasonYear: number) => Promise<DynastyHistory>;
};

/** Bridge exposed by preload.ts as `window.teamNeedsAPI`. */
export type TeamNeedsApi = {
  sync: () => Promise<TeamNeedsDynasty>;
  getTeamBranding: (teamName: string) => Promise<TeamBranding | null>;
};

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

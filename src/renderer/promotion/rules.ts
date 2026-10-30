// Promotion / Relegation rules. Pure functions over the imported dynasty data;
// no DOM access here so the logic is easy to read and test.
import type { DynastyHistory, DynastySnapshot, Movement, StoredSeason, TeamSeason } from '../../shared/types';

export type Pair = { key: string; upper: string; lower: string; label: string };

export const PAIRS: readonly Pair[] = [
  { key: 'acc-american', upper: 'ACC', lower: 'American', label: 'ACC ↕ American' },
  { key: 'bigten-mac', upper: 'Big Ten', lower: 'MAC', label: 'Big Ten ↕ MAC' },
  { key: 'big12-cusa', upper: 'Big 12', lower: 'C-USA', label: 'Big 12 ↕ C-USA' },
  { key: 'pac12-mw', upper: 'Pac-12', lower: 'Mountain West', label: 'Pac-12 ↕ Mountain West' },
  { key: 'sec-sunbelt', upper: 'SEC', lower: 'Sun Belt', label: 'SEC ↕ Sun Belt' },
];

export const TRACKED_CONFERENCES: readonly string[] = PAIRS.flatMap((pair) => [pair.upper, pair.lower]);
export const INDEPENDENT = 'Independent';
export const INDEPENDENT_PAIR_KEY = 'independent';

/** Everything the Promotion / Relegation pages render from. */
export type PromoData = {
  /** Locked review snapshot for the season being reviewed. */
  review: DynastySnapshot;
  /** Most recent sync of the same save (shows in-game conference changes). */
  latest: DynastySnapshot;
  history: DynastyHistory | null;
};

export type PairDraft = { promote: number | null; relegate: number | null };
export type IndependentDraft = { toIndependent: number | null; fromIndependent: number | null; destinationConference: string | null };

export type Recommendation = {
  promotionCandidate: TeamSeason | null;
  champion: TeamSeason | null;
  championProtected: boolean;
  relegationCandidate: TeamSeason | null;
  relegationReason: string;
  relegationTied: TeamSeason[];
  noAutomaticMovement: boolean;
};

export type MoveCheck = { movement: Movement; currentConference: string; state: 'verified' | 'pending' | 'mismatch' };
export type VerificationCounts = { verified: number; pending: number; mismatch: number; total: number };

// ---- Teams & conferences ---------------------------------------------------

export function isIndependent(team: TeamSeason): boolean {
  return `${team.conference ?? ''} ${team.conferenceEnum ?? ''}`.toLowerCase().includes('independent');
}

export function conferenceLabel(team: TeamSeason, fallback = '—'): string {
  return isIndependent(team) ? INDEPENDENT : (team.conference ?? fallback);
}

export function isTracked(team: TeamSeason): boolean {
  return isIndependent(team) || TRACKED_CONFERENCES.includes(team.conference ?? '');
}

export function teamsIn(snapshot: DynastySnapshot, conference: string): TeamSeason[] {
  if (conference === INDEPENDENT) return snapshot.teams.filter(isIndependent);
  return snapshot.teams.filter((team) => team.conference === conference);
}

export function teamByIndex(snapshot: DynastySnapshot, index: number | null): TeamSeason | null {
  return snapshot.teams.find((team) => team.teamIndex === index) ?? null;
}

export function seasonFor(history: DynastyHistory | null, year: number): StoredSeason | null {
  return history?.seasons.find((season) => season.seasonYear === year) ?? null;
}

export function currentSeason(data: PromoData): StoredSeason | null {
  return seasonFor(data.history, data.review.seasonYear);
}

export function pct(wins: number, losses: number, ties: number): number {
  const games = wins + losses + ties;
  return games ? (wins + ties * 0.5) / games : 0;
}

const confPct = (team: TeamSeason) => pct(team.confWins, team.confLosses, team.confTies);
const overallPct = (team: TeamSeason) => pct(team.overallWins, team.overallLosses, team.overallTies);
const same = (a: number, b: number) => Math.abs(a - b) < 0.000001;

// ---- Cooldowns ---------------------------------------------------------------

function closedMovements(history: DynastyHistory | null): Movement[] {
  return (history?.seasons ?? []).filter((season) => season.closed).flatMap((season) => season.movements);
}

/** Most recent closed-season move for a team before the given season. */
function lastMovementSeason(history: DynastyHistory | null, teamIndex: number, seasonYear: number): number | null {
  const years = closedMovements(history)
    .filter((movement) => movement.teamIndex === teamIndex && movement.seasonYear < seasonYear)
    .map((movement) => movement.seasonYear);
  return years.length ? Math.max(...years) : null;
}

/** A team moved in either of the two previous completed seasons cannot move again. */
export function isProtected(data: PromoData, teamIndex: number): boolean {
  const last = lastMovementSeason(data.history, teamIndex, data.review.seasonYear);
  return last != null && data.review.seasonYear - last <= 2;
}

export function cooldownLabel(data: PromoData, teamIndex: number): string {
  const last = lastMovementSeason(data.history, teamIndex, data.review.seasonYear);
  if (last == null) return 'Eligible';
  const diff = data.review.seasonYear - last;
  if (diff > 2) return 'Eligible';
  const remaining = 3 - diff;
  return `Protected · ${remaining} season${remaining === 1 ? '' : 's'}`;
}

/** Latest closed move for a team (any season), used by the Teams page. */
export function lastMove(history: DynastyHistory | null, teamIndex: number): Movement | null {
  return closedMovements(history).filter((move) => move.teamIndex === teamIndex).sort((a, b) => b.seasonYear - a.seasonYear)[0] ?? null;
}

/** Cooldown wording that also covers a move recorded in the season being viewed. */
export function moveStatus(history: DynastyHistory | null, teamIndex: number, year: number): string {
  const move = lastMove(history, teamIndex);
  if (!move) return 'Eligible';
  const diff = year - move.seasonYear;
  if (diff <= 0) return 'Cooldown starts next season';
  if (diff === 1) return 'Protected · 2 seasons';
  if (diff === 2) return 'Protected · 1 season';
  return 'Eligible';
}

// ---- Recommendations ---------------------------------------------------------

export function championFor(snapshot: DynastySnapshot, conference: string): TeamSeason | null {
  const row = snapshot.conferenceChampions.find((champ) => champ.seasonYear === snapshot.seasonYear && champ.conferenceName === conference);
  if (!row) return null;
  if (row.championTeamIndex != null) return teamByIndex(snapshot, row.championTeamIndex);
  return snapshot.teams.find((team) => team.displayName === row.championName) ?? null;
}

function headToHeadLoser(snapshot: DynastySnapshot, a: TeamSeason, b: TeamSeason): TeamSeason | null {
  const games = snapshot.games.filter((game) => game.isFinal &&
    ((game.homeTeamIndex === a.teamIndex && game.awayTeamIndex === b.teamIndex) || (game.homeTeamIndex === b.teamIndex && game.awayTeamIndex === a.teamIndex)));
  if (games.length !== 1) return null;
  const game = games[0];
  if (game.homeScore === game.awayScore) return null;
  return teamByIndex(snapshot, game.homeScore < game.awayScore ? game.homeTeamIndex : game.awayTeamIndex);
}

/**
 * Automatic rule for one pairing: the Tier 2 champion goes up unless protected;
 * the Tier 1 team with the worst conference record goes down (then overall
 * record, then head-to-head for a two-team tie). Anything else is manual.
 */
export function recommendation(data: PromoData, pair: Pair): Recommendation {
  const { review } = data;
  const champion = championFor(review, pair.lower);
  const championProtected = champion ? isProtected(data, champion.teamIndex) : false;
  const promotionCandidate = champion && !championProtected ? champion : null;
  const base = { promotionCandidate, champion, championProtected, relegationCandidate: null, relegationTied: [] as TeamSeason[] };
  if (!promotionCandidate) {
    return { ...base, relegationReason: champion ? 'No automatic swap while champion is protected.' : 'Conference champion not found yet.', noAutomaticMovement: true };
  }

  const eligible = teamsIn(review, pair.upper).filter((team) => !isProtected(data, team.teamIndex));
  if (!eligible.length) return { ...base, relegationReason: 'No eligible Tier 1 team.', noAutomaticMovement: false };
  const ranked = [...eligible].sort((a, b) => {
    const conf = confPct(a) - confPct(b);
    if (Math.abs(conf) > 0.000001) return conf;
    const overall = overallPct(a) - overallPct(b);
    if (Math.abs(overall) > 0.000001) return overall;
    return a.displayName.localeCompare(b.displayName);
  });
  const worst = ranked[0];
  const tied = ranked.filter((team) => same(confPct(team), confPct(worst)) && same(overallPct(team), overallPct(worst)));
  if (tied.length === 1) {
    const sameConf = eligible.filter((team) => same(confPct(team), confPct(worst)));
    return { ...base, relegationCandidate: worst, relegationReason: sameConf.length > 1 ? 'Conference record tie → worse overall record' : 'Worst conference winning percentage', noAutomaticMovement: false };
  }
  if (tied.length === 2) {
    const loser = headToHeadLoser(review, tied[0], tied[1]);
    if (loser) return { ...base, relegationCandidate: loser, relegationReason: 'Conference + overall tie → head-to-head loser', relegationTied: tied, noAutomaticMovement: false };
  }
  return { ...base, relegationReason: 'Manual tiebreak required', relegationTied: tied, noAutomaticMovement: false };
}

export function defaultDraft(data: PromoData, pair: Pair): PairDraft {
  const rec = recommendation(data, pair);
  return { promote: rec.promotionCandidate?.teamIndex ?? null, relegate: rec.relegationCandidate?.teamIndex ?? null };
}

export function isManualTiebreak(rec: Recommendation, teamIndex: number): boolean {
  return !rec.relegationCandidate && rec.relegationTied.some((team) => team.teamIndex === teamIndex);
}

// ---- Drafts ↔ movements --------------------------------------------------------

export function draftsFromSeason(season: StoredSeason | null | undefined): Map<string, PairDraft> {
  const drafts = new Map<string, PairDraft>();
  if (!season) return drafts;
  for (const pair of PAIRS) {
    const promotion = season.movements.find((movement) => movement.pairKey === pair.key && movement.kind === 'promotion');
    const relegation = season.movements.find((movement) => movement.pairKey === pair.key && movement.kind === 'relegation');
    if (!promotion && !relegation) continue;
    drafts.set(pair.key, { promote: promotion?.teamIndex ?? null, relegate: relegation?.teamIndex ?? null });
  }
  return drafts;
}

export function independentDraftFromSeason(season: StoredSeason | null | undefined): IndependentDraft {
  const moves = season?.movements ?? [];
  const toIndependent = moves.find((movement) => movement.pairKey === INDEPENDENT_PAIR_KEY && movement.kind === 'to-independent');
  const fromIndependent = moves.find((movement) => movement.pairKey === INDEPENDENT_PAIR_KEY && movement.kind === 'from-independent');
  return {
    toIndependent: toIndependent?.teamIndex ?? null,
    fromIndependent: fromIndependent?.teamIndex ?? null,
    destinationConference: fromIndependent?.toConference ?? null,
  };
}

/** Turn the current selections into movements to store when the season closes. */
export function movementPayload(data: PromoData, draftFor: (pair: Pair) => PairDraft, independent: IndependentDraft): Movement[] {
  const { review } = data;
  const year = review.seasonYear;
  const movements: Movement[] = [];
  for (const pair of PAIRS) {
    const draft = draftFor(pair);
    const rec = recommendation(data, pair);
    const promoted = teamByIndex(review, draft.promote);
    const relegated = teamByIndex(review, draft.relegate);
    if (Boolean(promoted) !== Boolean(relegated)) throw new Error(`${pair.label}: choose both a promotion and relegation, or neither.`);
    if (!promoted || !relegated) continue;
    const autoPromotion = promoted.teamIndex === rec.promotionCandidate?.teamIndex;
    movements.push({ seasonYear: year, pairKey: pair.key, kind: 'promotion', teamIndex: promoted.teamIndex, teamName: promoted.displayName, fromConference: pair.lower, toConference: pair.upper, mode: autoPromotion ? 'automatic' : 'manual', reason: autoPromotion ? 'Conference champion' : 'Manual override' });
    const autoRelegation = relegated.teamIndex === rec.relegationCandidate?.teamIndex;
    const reason = autoRelegation ? rec.relegationReason : isManualTiebreak(rec, relegated.teamIndex) ? 'Manual tiebreak' : 'Manual override';
    movements.push({ seasonYear: year, pairKey: pair.key, kind: 'relegation', teamIndex: relegated.teamIndex, teamName: relegated.displayName, fromConference: pair.upper, toConference: pair.lower, mode: autoRelegation ? 'automatic' : 'manual', reason });
  }

  const toIndependent = teamByIndex(review, independent.toIndependent);
  const fromIndependent = teamByIndex(review, independent.fromIndependent);
  const manual = { seasonYear: year, pairKey: INDEPENDENT_PAIR_KEY, mode: 'manual' as const, reason: 'Manual Independent move' };
  if (toIndependent) {
    movements.push({ ...manual, kind: 'to-independent', teamIndex: toIndependent.teamIndex, teamName: toIndependent.displayName, fromConference: conferenceLabel(toIndependent), toConference: INDEPENDENT });
  }
  if (fromIndependent && independent.destinationConference) {
    movements.push({ ...manual, kind: 'from-independent', teamIndex: fromIndependent.teamIndex, teamName: fromIndependent.displayName, fromConference: INDEPENDENT, toConference: independent.destinationConference });
  }
  return movements;
}

// ---- Alignment verification ------------------------------------------------------

/** Compare recorded moves with the latest synced save. */
export function checkMovements(movements: Movement[], latest: DynastySnapshot): MoveCheck[] {
  return movements.map((movement) => {
    const team = latest.teams.find((item) => item.teamIndex === movement.teamIndex);
    const currentConference = team ? conferenceLabel(team, 'Unknown') : 'Unknown';
    const state: MoveCheck['state'] = currentConference === movement.toConference
      ? 'verified'
      : currentConference === movement.fromConference ? 'pending' : 'mismatch';
    return { movement, currentConference, state };
  });
}

export function countChecks(checks: MoveCheck[]): VerificationCounts {
  return {
    verified: checks.filter((check) => check.state === 'verified').length,
    pending: checks.filter((check) => check.state === 'pending').length,
    mismatch: checks.filter((check) => check.state === 'mismatch').length,
    total: checks.length,
  };
}

/** True when any team's conference in the latest save differs from the review snapshot. */
export function alignmentChanged(review: DynastySnapshot, latest: DynastySnapshot): boolean {
  return review.teams.some((team) => {
    const current = latest.teams.find((item) => item.teamIndex === team.teamIndex);
    return Boolean(current) && conferenceLabel(current!, 'Unknown') !== conferenceLabel(team, 'Unknown');
  });
}

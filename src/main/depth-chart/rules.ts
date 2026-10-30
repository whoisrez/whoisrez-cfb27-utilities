// Depth chart rules for defense, offense and special teams.
//
// Pure logic (no Electron / save-file access) so it can be tested on its own.
//
// Base positions
//   1. Position lock: a base spot is filled only with players listed at that
//      position, so blowout subs never pull a starter into a different spot.
//   2. Overall decides the order. When two players are within TIE_WINDOW overall
//      points, the ratings that matter most for that spot break the tie.
//   3. A position group too small for its spots borrows players who are on no
//      other base list: first from the same unit, then from the same side.
// Packages and special teams
//   4. Each package ranks its own position group by the ratings that package is
//      for (pass rush, run fit, slot coverage, receiving back, power back...).
//   5. RLE/RRE #1 may be a backup SAM/WILL who out-rushes every end on that side.
//   6. Returners and the long snapper come from non-starters, so a starter is
//      not exposed on special teams; kickers back each other up because
//      specialists never come in as blowout subs.
// Your chart wins ties
//   7. A spot keeps the player your current chart has there unless the rules'
//      pick is clearly better: more than TIE_WINDOW overall (base spots) or more
//      than KEEP_MARGIN on that spot's rating score. Out-of-position players and
//      starters from other spots are always replaced.
// Injuries
//   8. Injured players keep their spot (the game plays the next healthy player
//      until they are back), so the chart is still right the day they return.

import type { DcEntry, DcPlan, DcPlayer, DcSide, DcSlotPlan } from '../../shared/depth-chart';
import { DISPLAY_POSITION } from '../../shared/depth-chart';

export const TIE_WINDOW = 1;
/** A different player must beat the current chart's choice by more than this (rating-score points) to replace him. */
export const KEEP_MARGIN = 2.5;

type Score = (p: DcPlayer) => number;

type BaseDef = {
  key: string;
  label: string;
  help: string;
  side: DcSide;
  positions: string[];
  starters: number;
  unit: string;
  score: Score;
  /** What the tiebreak ratings are called in the "Why" notes. */
  scoreLabel: string;
};

const r = (p: DcPlayer, key: string) => Number(p.ratings[key] ?? 0);
const avg = (...values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const weightScore = (lbs: number, floor: number) => Math.max(0, Math.min(99, ((lbs - floor) / 100) * 99));
const pos = (code: string) => DISPLAY_POSITION[code] ?? code;
const fmt = (value: number) => String(Math.round(value));

// ---- Scores ---------------------------------------------------------------------------

const moves = (p: DcPlayer) => Math.max(r(p, 'pmv'), r(p, 'fmv'));
const otherMove = (p: DcPlayer) => Math.min(r(p, 'pmv'), r(p, 'fmv'));

export const SCORES = {
  edge: (p: DcPlayer) => 0.2 * moves(p) + 0.2 * r(p, 'bsh') + 0.15 * r(p, 'tak') + 0.15 * r(p, 'prc') + 0.15 * r(p, 'acc') + 0.15 * r(p, 'str'),
  dt: (p: DcPlayer) => 0.25 * r(p, 'bsh') + 0.2 * r(p, 'str') + 0.2 * moves(p) + 0.15 * r(p, 'tak') + 0.1 * r(p, 'prc') + 0.1 * weightScore(p.weight, 230),
  sam: (p: DcPlayer) => 0.25 * r(p, 'spd') + 0.25 * r(p, 'zcv') + 0.15 * r(p, 'tak') + 0.15 * r(p, 'prc') + 0.1 * r(p, 'pur') + 0.1 * r(p, 'bsh'),
  mike: (p: DcPlayer) => 0.2 * r(p, 'pur') + 0.2 * r(p, 'bsh') + 0.2 * r(p, 'tak') + 0.2 * r(p, 'zcv') + 0.2 * r(p, 'prc'),
  will: (p: DcPlayer) => 0.2 * r(p, 'spd') + 0.2 * r(p, 'zcv') + 0.15 * r(p, 'mcv') + 0.15 * r(p, 'tak') + 0.15 * r(p, 'pur') + 0.15 * r(p, 'prc'),
  cb: (p: DcPlayer) => 0.3 * r(p, 'mcv') + 0.3 * r(p, 'zcv') + 0.2 * r(p, 'spd') + 0.1 * r(p, 'acc') + 0.1 * r(p, 'prs'),
  fs: (p: DcPlayer) => 0.35 * r(p, 'zcv') + 0.15 * r(p, 'mcv') + 0.2 * r(p, 'spd') + 0.15 * r(p, 'prc') + 0.15 * r(p, 'awr'),
  ss: (p: DcPlayer) => 0.25 * r(p, 'zcv') + 0.2 * r(p, 'tak') + 0.15 * r(p, 'pur') + 0.15 * r(p, 'prc') + 0.15 * r(p, 'spd') + 0.1 * r(p, 'mcv'),
  passRush: (p: DcPlayer) => 0.35 * moves(p) + 0.15 * otherMove(p) + 0.2 * r(p, 'bsh') + 0.2 * r(p, 'acc') + 0.1 * r(p, 'str'),
  nose: (p: DcPlayer) => 0.25 * r(p, 'bsh') + 0.2 * r(p, 'str') + 0.2 * r(p, 'tak') + 0.2 * r(p, 'prc') + 0.15 * weightScore(p.weight, 230),
  slotCorner: (p: DcPlayer) => 0.25 * r(p, 'mcv') + 0.25 * r(p, 'zcv') + 0.2 * r(p, 'acc') + 0.15 * r(p, 'spd') + 0.15 * r(p, 'agi') + (/slot/i.test(p.archetype) ? 4 : 0),

  qb: (p: DcPlayer) => 0.3 * avg(r(p, 'tas'), r(p, 'tam'), r(p, 'tad')) + 0.2 * r(p, 'thp') + 0.2 * r(p, 'tup') + 0.2 * r(p, 'awr') + 0.1 * r(p, 'spd'),
  hb: (p: DcPlayer) => 0.2 * r(p, 'bcv') + 0.2 * r(p, 'spd') + 0.15 * r(p, 'acc') + 0.15 * r(p, 'btk') + 0.1 * r(p, 'car') + 0.1 * r(p, 'cth') + 0.1 * r(p, 'jkm'),
  fb: (p: DcPlayer) => 0.3 * r(p, 'lbk') + 0.25 * r(p, 'rbk') + 0.2 * r(p, 'ibl') + 0.15 * r(p, 'str') + 0.1 * r(p, 'pbk'),
  wr: (p: DcPlayer) => 0.2 * r(p, 'spd') + 0.2 * r(p, 'cth') + 0.2 * avg(r(p, 'srr'), r(p, 'mrr'), r(p, 'drr')) + 0.15 * r(p, 'rls') + 0.15 * r(p, 'cit') + 0.1 * r(p, 'agi'),
  te: (p: DcPlayer) => 0.25 * r(p, 'cth') + 0.2 * r(p, 'rbk') + 0.15 * r(p, 'pbk') + 0.15 * r(p, 'srr') + 0.15 * r(p, 'spd') + 0.1 * r(p, 'cit'),
  tackle: (p: DcPlayer) => 0.35 * r(p, 'pbk') + 0.25 * r(p, 'rbk') + 0.15 * r(p, 'str') + 0.15 * r(p, 'awr') + 0.1 * avg(r(p, 'pbp'), r(p, 'pbf')),
  interior: (p: DcPlayer) => 0.3 * r(p, 'rbk') + 0.3 * r(p, 'pbk') + 0.2 * r(p, 'str') + 0.2 * r(p, 'awr'),
  thirdDownBack: (p: DcPlayer) => 0.3 * r(p, 'cth') + 0.25 * r(p, 'srr') + 0.25 * r(p, 'pbk') + 0.1 * r(p, 'spd') + 0.1 * r(p, 'car'),
  powerBack: (p: DcPlayer) => 0.3 * r(p, 'btk') + 0.25 * r(p, 'trk') + 0.2 * r(p, 'car') + 0.15 * r(p, 'str') + 0.1 * r(p, 'bcv'),
  slotReceiver: (p: DcPlayer) => 0.3 * r(p, 'srr') + 0.2 * r(p, 'agi') + 0.2 * r(p, 'cth') + 0.15 * r(p, 'rls') + 0.15 * r(p, 'acc'),
  gadget: (p: DcPlayer) => 0.25 * r(p, 'spd') + 0.2 * r(p, 'acc') + 0.2 * r(p, 'agi') + 0.2 * r(p, 'bcv') + 0.15 * r(p, 'car'),

  kicker: (p: DcPlayer) => 0.5 * r(p, 'kpw') + 0.5 * r(p, 'kac'),
  punter: (p: DcPlayer) => 0.55 * r(p, 'kpw') + 0.45 * r(p, 'kac'),
  kickoff: (p: DcPlayer) => 0.7 * r(p, 'kpw') + 0.3 * r(p, 'kac'),
  kickReturn: (p: DcPlayer) => 0.4 * r(p, 'ret') + 0.2 * r(p, 'spd') + 0.15 * r(p, 'acc') + 0.15 * r(p, 'car') + 0.1 * r(p, 'bcv'),
  puntReturn: (p: DcPlayer) => 0.4 * r(p, 'ret') + 0.2 * r(p, 'cth') + 0.15 * r(p, 'agi') + 0.15 * r(p, 'car') + 0.1 * r(p, 'acc'),
  longSnap: (p: DcPlayer) => r(p, 'ls'),
} satisfies Record<string, Score>;

// ---- Slot definitions ------------------------------------------------------------------

export const BASE_SLOTS: BaseDef[] = [
  { key: 'LE', label: 'LEDG', help: 'Left edge', side: 'defense', positions: ['LE'], starters: 1, unit: 'DL', score: SCORES.edge, scoreLabel: 'edge' },
  { key: 'RE', label: 'REDG', help: 'Right edge', side: 'defense', positions: ['RE'], starters: 1, unit: 'DL', score: SCORES.edge, scoreLabel: 'edge' },
  { key: 'DT', label: 'DT', help: 'Defensive tackle · top 2 start in 4-man fronts', side: 'defense', positions: ['DT'], starters: 2, unit: 'DL', score: SCORES.dt, scoreLabel: 'DT' },
  { key: 'LOLB', label: 'SAM', help: 'Strong-side linebacker', side: 'defense', positions: ['LOLB'], starters: 1, unit: 'LB', score: SCORES.sam, scoreLabel: 'SAM' },
  { key: 'MLB', label: 'MIKE', help: 'Middle linebacker · top 2 start in 3-4 looks', side: 'defense', positions: ['MLB'], starters: 2, unit: 'LB', score: SCORES.mike, scoreLabel: 'MIKE' },
  { key: 'ROLB', label: 'WILL', help: 'Weak-side linebacker', side: 'defense', positions: ['ROLB'], starters: 1, unit: 'LB', score: SCORES.will, scoreLabel: 'WILL' },
  { key: 'CB', label: 'CB', help: 'Cornerback · top 2 start', side: 'defense', positions: ['CB'], starters: 2, unit: 'DB', score: SCORES.cb, scoreLabel: 'coverage' },
  { key: 'FS', label: 'FS', help: 'Free safety', side: 'defense', positions: ['FS'], starters: 1, unit: 'DB', score: SCORES.fs, scoreLabel: 'FS' },
  { key: 'SS', label: 'SS', help: 'Strong safety', side: 'defense', positions: ['SS'], starters: 1, unit: 'DB', score: SCORES.ss, scoreLabel: 'SS' },

  { key: 'QB', label: 'QB', help: 'Quarterback', side: 'offense', positions: ['QB'], starters: 1, unit: 'QB', score: SCORES.qb, scoreLabel: 'passing' },
  { key: 'HB', label: 'HB', help: 'Halfback', side: 'offense', positions: ['HB'], starters: 1, unit: 'BACK', score: SCORES.hb, scoreLabel: 'rushing' },
  { key: 'FB', label: 'FB', help: 'Fullback', side: 'offense', positions: ['FB'], starters: 1, unit: 'BACK', score: SCORES.fb, scoreLabel: 'blocking' },
  { key: 'WR', label: 'WR', help: 'Wide receiver · top 2 start outside', side: 'offense', positions: ['WR'], starters: 2, unit: 'REC', score: SCORES.wr, scoreLabel: 'receiving' },
  { key: 'TE', label: 'TE', help: 'Tight end', side: 'offense', positions: ['TE'], starters: 1, unit: 'REC', score: SCORES.te, scoreLabel: 'TE' },
  { key: 'LT', label: 'LT', help: 'Left tackle', side: 'offense', positions: ['LT'], starters: 1, unit: 'OL', score: SCORES.tackle, scoreLabel: 'tackle' },
  { key: 'LG', label: 'LG', help: 'Left guard', side: 'offense', positions: ['LG'], starters: 1, unit: 'OL', score: SCORES.interior, scoreLabel: 'blocking' },
  { key: 'C', label: 'C', help: 'Center', side: 'offense', positions: ['C'], starters: 1, unit: 'OL', score: SCORES.interior, scoreLabel: 'blocking' },
  { key: 'RG', label: 'RG', help: 'Right guard', side: 'offense', positions: ['RG'], starters: 1, unit: 'OL', score: SCORES.interior, scoreLabel: 'blocking' },
  { key: 'RT', label: 'RT', help: 'Right tackle', side: 'offense', positions: ['RT'], starters: 1, unit: 'OL', score: SCORES.tackle, scoreLabel: 'tackle' },

  { key: 'K', label: 'K', help: 'Kicker', side: 'special', positions: ['K'], starters: 1, unit: 'KP', score: SCORES.kicker, scoreLabel: 'kicking' },
  { key: 'P', label: 'P', help: 'Punter', side: 'special', positions: ['P'], starters: 1, unit: 'KP', score: SCORES.punter, scoreLabel: 'punting' },
];

const UNITS: Record<string, string[]> = {
  DL: ['LE', 'RE', 'DT'], LB: ['LOLB', 'MLB', 'ROLB'], DB: ['CB', 'FS', 'SS'],
  QB: ['QB'], BACK: ['HB', 'FB'], REC: ['WR', 'TE'], OL: ['LT', 'LG', 'C', 'RG', 'RT'], KP: ['K', 'P'],
};
/** Second fallback when a unit has no spare players. QBs and specialists are never borrowed. */
const SIDE_POOL: Record<DcSide, string[]> = {
  defense: [...UNITS.DL, ...UNITS.LB, ...UNITS.DB],
  offense: [...UNITS.BACK, ...UNITS.REC, ...UNITS.OL],
  special: UNITS.KP,
};

type PackageDef = { key: string; label: string; help: string; side: DcSide; positions: string[]; starters: number };

export const PACKAGE_SLOTS: PackageDef[] = [
  { key: 'RLE', label: 'RLE', help: 'Pass-rush left end', side: 'defense', positions: ['LE'], starters: 1 },
  { key: 'RRE', label: 'RRE', help: 'Pass-rush right end', side: 'defense', positions: ['RE'], starters: 1 },
  { key: 'RDT', label: 'RDT', help: 'Pass-rush tackle', side: 'defense', positions: ['DT'], starters: 2 },
  { key: 'NT', label: 'NT', help: 'Nose tackle', side: 'defense', positions: ['DT'], starters: 1 },
  { key: 'SUBLB', label: 'SUBLB', help: 'Nickel / dime linebacker', side: 'defense', positions: ['MLB'], starters: 1 },
  { key: 'SLCB', label: 'SLCB', help: 'Slot corner', side: 'defense', positions: ['CB'], starters: 1 },
  { key: '3DRB', label: '3DRB', help: 'Third-down back', side: 'offense', positions: ['HB'], starters: 1 },
  { key: 'PWHB', label: 'PWHB', help: 'Power / goal-line back', side: 'offense', positions: ['HB'], starters: 1 },
  { key: 'SLWR', label: 'SLWR', help: 'Slot receiver', side: 'offense', positions: ['WR'], starters: 1 },
  { key: 'GAD', label: 'GAD', help: 'Gadget player', side: 'offense', positions: ['WR'], starters: 1 },
  { key: 'KOS', label: 'KOS', help: 'Kickoff specialist', side: 'special', positions: ['K', 'P'], starters: 1 },
  { key: 'KR', label: 'KR', help: 'Kick returner', side: 'special', positions: ['HB', 'FB', 'WR', 'TE', 'CB', 'FS', 'SS'], starters: 1 },
  { key: 'PR', label: 'PR', help: 'Punt returner', side: 'special', positions: ['HB', 'FB', 'WR', 'TE', 'CB', 'FS', 'SS'], starters: 1 },
  { key: 'LS', label: 'LS', help: 'Long snapper', side: 'special', positions: [], starters: 1 },
];

export const ALL_SLOT_KEYS: string[] = [...BASE_SLOTS.map((slot) => slot.key), ...PACKAGE_SLOTS.map((slot) => slot.key)];

// ---- Ordering ------------------------------------------------------------------------------

/**
 * Overall first; inside TIE_WINDOW the role score decides. A stable insertion
 * sort keeps the (non-transitive) tie rule deterministic.
 */
export function orderForSlot(players: DcPlayer[], score: Score): DcPlayer[] {
  const sorted = [...players].sort((a, b) => b.ovr - a.ovr || score(b) - score(a) || a.row - b.row);
  for (let i = 1; i < sorted.length; i += 1) {
    let j = i;
    while (j > 0 && Math.abs(sorted[j - 1].ovr - sorted[j].ovr) <= TIE_WINDOW && score(sorted[j]) > score(sorted[j - 1]) + 1e-9) {
      [sorted[j - 1], sorted[j]] = [sorted[j], sorted[j - 1]];
      j -= 1;
    }
  }
  return sorted;
}

const byScore = (players: DcPlayer[], score: Score) =>
  [...players].sort((a, b) => score(b) - score(a) || b.ovr - a.ovr || a.row - b.row);

// ---- Builder ---------------------------------------------------------------------------------

export type BuildInput = {
  players: DcPlayer[];
  /** Number of spots the game uses for each list (the save's array sizes). */
  sizes: Record<string, number>;
  /** Current depth chart rows for each list. */
  current: Record<string, number[]>;
};

type Pick = { player: DcPlayer; kept: boolean };

/** True when `a` should replace `b`: clearly better, not just a hair better. */
function clearlyBetter(a: DcPlayer, b: DcPlayer, score: Score, useOverall: boolean): boolean {
  if (useOverall && a.ovr - b.ovr > TIE_WINDOW) return true;
  if (useOverall && b.ovr - a.ovr > TIE_WINDOW) return false;
  return score(a) - score(b) > KEEP_MARGIN;
}

/**
 * Fill `size` spots from `ideal` (best first). At each spot the current chart's
 * player stays if he is eligible and the best remaining option is not clearly better.
 */
function stablePick(ideal: DcPlayer[], current: number[], size: number, score: Score, useOverall: boolean): Pick[] {
  const pool = new Map(ideal.map((p) => [p.row, p]));
  const used = new Set<number>();
  const picks: Pick[] = [];
  for (let i = 0; i < size; i += 1) {
    const best = ideal.find((p) => !used.has(p.row));
    if (!best) break;
    const cur = pool.get(current[i]);
    const keep = Boolean(cur && cur.row !== best.row && !used.has(cur.row) && !clearlyBetter(best, cur, score, useOverall));
    const player = keep ? cur! : best;
    used.add(player.row);
    picks.push({ player, kept: keep });
  }
  return picks;
}

export function buildDepthChart(input: BuildInput): DcPlan {
  const { players, sizes, current } = input;
  const byRow = new Map(players.map((p) => [p.row, p]));
  const inPositions = (positions: string[]) => players.filter((p) => positions.includes(p.position));
  const sizeOf = (key: string) => Math.max(0, Number(sizes[key] ?? 0));
  const currentOf = (key: string) => current[key] ?? [];

  const baseLists = new Map<string, Pick[]>();
  const fillNotes = new Map<string, Map<number, string>>();
  const onBaseList = new Set<number>();
  const fillNote = (key: string) => {
    if (!fillNotes.has(key)) fillNotes.set(key, new Map());
    return fillNotes.get(key)!;
  };

  // Pass 1: position-locked lists.
  for (const def of BASE_SLOTS) {
    if (!(def.key in sizes)) continue;
    const picks = stablePick(orderForSlot(inPositions(def.positions), def.score), currentOf(def.key), sizeOf(def.key), def.score, true);
    picks.forEach((pick) => onBaseList.add(pick.player.row));
    baseLists.set(def.key, picks);
  }

  // Pass 2: short groups borrow unlisted players — same unit first, then the same side.
  for (const def of BASE_SLOTS) {
    const list = baseLists.get(def.key);
    if (!list || list.length >= sizeOf(def.key)) continue;
    // Kickers and punters back each other up even when listed elsewhere: specialists never sub in blowouts.
    const specialist = def.unit === 'KP';
    for (const pool of [UNITS[def.unit], SIDE_POOL[def.side]]) {
      const taken = new Set(list.map((pick) => pick.player.row));
      const spare = byScore(players.filter((p) => pool.includes(p.position) && !taken.has(p.row) && (specialist || !onBaseList.has(p.row))), def.score);
      const picks = stablePick(spare, currentOf(def.key).slice(list.length), sizeOf(def.key) - list.length, def.score, false);
      for (const pick of picks) {
        list.push(pick);
        if (!specialist) onBaseList.add(pick.player.row);
        const p = pick.player;
        fillNote(def.key).set(p.row, specialist
          ? `Backup ${def.label} from the ${pos(p.position)} spot (${def.scoreLabel} ${fmt(def.score(p))}). Specialists never come in as blowout subs, so sharing is safe.`
          : `Fill-in from ${pos(p.position)} (${def.scoreLabel} ${fmt(def.score(p))}): there are not enough ${def.label}s, and he is on no other list, so no starter gets pulled here.`);
      }
      if (list.length >= sizeOf(def.key)) break;
    }
  }

  /** Starters by base spot (first N healthy players count as the ones on the field). */
  const startsAt = new Map<number, string>();
  for (const def of BASE_SLOTS) {
    const healthy = (baseLists.get(def.key) ?? []).filter((pick) => !pick.player.injury);
    healthy.slice(0, def.starters).forEach((pick) => { if (!startsAt.has(pick.player.row)) startsAt.set(pick.player.row, def.label); });
  }
  const isStarter = (row: number) => startsAt.has(row);

  const slots: DcSlotPlan[] = [];
  const finish = (
    def: { key: string; label: string; help: string; side: DcSide; positions: string[]; starters: number },
    picks: Pick[],
    describe: (p: DcPlayer, index: number) => string,
    score: Score,
    scoreLabel: string,
    useOverall: boolean,
  ) => {
    const now = currentOf(def.key).slice(0, sizeOf(def.key));
    const nextRows = picks.map((pick) => pick.player.row);
    const injuredStarters = picks.slice(0, def.starters).filter((pick) => pick.player.injury).map((pick) => pick.player.name);
    let healthySeen = 0;
    const entries: DcEntry[] = picks.map((pick, index) => {
      const p = pick.player;
      const playsForInjured = !p.injury && index >= def.starters && healthySeen < def.starters && injuredStarters.length > 0;
      if (!p.injury) healthySeen += 1;
      const injuryNote = p.injury
        ? ` Injured (${injuryLabel(p)}): keeps this spot, and the next healthy player starts until he is back.`
        : playsForInjured ? ` Plays while ${injuredStarters.join(' and ')} ${injuredStarters.length > 1 ? 'are' : 'is'} out.` : '';
      const keptNote = pick.kept ? ' Kept from your current chart: the top alternative is not clearly better.' : '';
      const entry: DcEntry = { row: p.row, note: `${describe(p, index)}${keptNote}${injuryNote}`, kept: pick.kept || undefined };
      if (now[index] !== p.row) entry.versus = versusText(def, index, p, now[index], nextRows, score, scoreLabel, useOverall);
      return entry;
    });
    slots.push(makeSlot(def, sizeOf(def.key), now, entries));
  };

  /** Explain why `next` is better at spot `index` than the current chart's player there. */
  function versusText(
    def: { key: string; label: string; positions: string[] },
    index: number,
    next: DcPlayer,
    curRow: number | undefined,
    nextRows: number[],
    score: Score,
    scoreLabel: string,
    useOverall: boolean,
  ): string {
    if (curRow === undefined) return 'Fills a spot that is empty now.';
    const cur = byRow.get(curRow);
    if (!cur) return `Replaces a player who is no longer on the roster at #${index + 1}.`;
    const whereNow = nextRows.indexOf(cur.row);
    const moved = whereNow >= 0 ? ` ${cur.name} moves to #${whereNow + 1}.` : ` ${cur.name} comes off this list.`;
    if (def.positions.length && !def.positions.includes(cur.position) && !['KR', 'PR', 'LS', 'K', 'P', 'KOS'].includes(def.key)) {
      return `Over ${cur.name}: he is a ${pos(cur.position)}, not a ${def.label}, so he does not belong here.${moved}`;
    }
    const startsElsewhere = startsAt.get(cur.row);
    if (startsElsewhere && startsElsewhere !== def.label) {
      return `Over ${cur.name}: he starts at ${startsElsewhere}, so a sub here would pull a starter off his spot.${moved}`;
    }
    if (useOverall && next.ovr - cur.ovr > TIE_WINDOW) return `Over ${cur.name}: ${next.ovr} overall vs ${cur.ovr}.${moved}`;
    const a = score(next);
    const b = score(cur);
    if (whereNow >= 0 && whereNow < index) return `${cur.name} moves up to #${whereNow + 1}, so ${next.name} shifts to #${index + 1}.`;
    if (a > b) return `Over ${cur.name}: better ${scoreLabel} ratings (${fmt(a)} vs ${fmt(b)}).${moved}`;
    return `Over ${cur.name}: ${next.name} fits this spot better.${moved}`;
  }

  for (const def of BASE_SLOTS) {
    const picks = baseLists.get(def.key);
    if (!picks) continue;
    finish(def, picks, (p, index) => fillNote(def.key).get(p.row) ?? baseNote(p, index, picks.map((pick) => pick.player), def), def.score, def.scoreLabel, true);
  }

  // ---- Packages ----
  const pkg = (key: string) => PACKAGE_SLOTS.find((item) => item.key === key)!;
  const has = (key: string) => key in sizes;
  /** Rank a package from its group (best first), keep current picks that are not clearly worse, top up if short. */
  const packagePicks = (key: string, group: DcPlayer[], score: Score, topUpPositions: string[], startAt = 0, exclude = new Set<number>()): Pick[] => {
    const size = sizeOf(key) - startAt;
    const ideal = byScore(group.filter((p) => !exclude.has(p.row)), score);
    const picks = stablePick(ideal, currentOf(key).slice(startAt), size, score, false);
    if (picks.length < size) {
      const taken = new Set([...picks.map((pick) => pick.player.row), ...exclude]);
      const spare = byScore(players.filter((p) => topUpPositions.includes(p.position) && !taken.has(p.row) && !isStarter(p.row)), score);
      picks.push(...stablePick(spare, currentOf(key).slice(startAt + picks.length), size - picks.length, score, false));
    }
    return picks;
  };
  const describeFill = (positions: string[], label: string, score: Score, text: (p: DcPlayer) => string) =>
    (p: DcPlayer) => (positions.includes(p.position) ? text(p) : `Fill-in from ${pos(p.position)} (${label} ${fmt(score(p))}): the position group is too small for every spot.`);

  // Defense
  const edgeImports = players.filter((p) => (p.position === 'LOLB' || p.position === 'ROLB') && !isStarter(p.row));
  const usedImports = new Set<number>();
  for (const [key, position] of [['RLE', 'LE'], ['RRE', 'RE']] as const) {
    if (!has(key)) continue;
    const group = inPositions([position]);
    const best = byScore(group, SCORES.passRush)[0];
    const candidate = byScore(edgeImports.filter((p) => !usedImports.has(p.row)), SCORES.passRush)[0];
    const picks: Pick[] = [];
    if (candidate) {
      const isCurrent = currentOf(key)[0] === candidate.row;
      const beatsEnds = !best || clearlyBetter(candidate, best, SCORES.passRush, false) || (isCurrent && SCORES.passRush(candidate) >= SCORES.passRush(best));
      if (beatsEnds) {
        usedImports.add(candidate.row);
        picks.push({ player: candidate, kept: false });
      }
    }
    picks.push(...packagePicks(key, group, SCORES.passRush, UNITS.DL, picks.length));
    const lead = picks[0]?.player;
    finish(pkg(key), picks, (p) => (p === lead && !group.includes(p)
      ? `Best pass rusher available (rush ${fmt(SCORES.passRush(p))} vs ${best ? fmt(SCORES.passRush(best)) : '—'} for the best ${pos(position)}). He is a backup ${pos(p.position)}, so this gets him snaps without moving a starter.`
      : describeFill([position], 'pass rush', SCORES.passRush, (q) => `${pos(position)} pass rush ${fmt(SCORES.passRush(q))} (Power ${r(q, 'pmv')} / Finesse ${r(q, 'fmv')}, Block Shed ${r(q, 'bsh')}).`)(p)),
    SCORES.passRush, 'pass rush', false);
  }
  if (has('RDT')) finish(pkg('RDT'), packagePicks('RDT', inPositions(['DT']), SCORES.passRush, UNITS.DL),
    describeFill(['DT'], 'pass rush', SCORES.passRush, (p) => `Inside pass rush ${fmt(SCORES.passRush(p))} (Power ${r(p, 'pmv')} / Finesse ${r(p, 'fmv')}, Accel ${r(p, 'acc')}).`), SCORES.passRush, 'pass rush', false);
  if (has('NT')) finish(pkg('NT'), packagePicks('NT', inPositions(['DT']), SCORES.nose, UNITS.DL),
    describeFill(['DT'], 'run fit', SCORES.nose, (p) => `Run fit ${fmt(SCORES.nose(p))} (${p.weight} lbs, Block Shed ${r(p, 'bsh')}, Play Rec ${r(p, 'prc')}).`), SCORES.nose, 'run fit', false);
  if (has('SUBLB')) {
    const mike = (baseLists.get('MLB') ?? []).slice(0, sizeOf('SUBLB')).map((pick) => ({ player: pick.player, kept: false }));
    finish(pkg('SUBLB'), mike, (_p, index) => `Same order as MIKE #${index + 1}, so a blowout sub here is the same MIKE who would come in anyway.`, SCORES.mike, 'MIKE', false);
  }
  if (has('SLCB')) {
    const outside = new Set((baseLists.get('CB') ?? []).slice(0, 2).map((pick) => pick.player.row));
    finish(pkg('SLCB'), packagePicks('SLCB', inPositions(['CB']), SCORES.slotCorner, UNITS.DB, 0, outside),
      describeFill(['CB'], 'slot coverage', SCORES.slotCorner, (p) => `Slot coverage ${fmt(SCORES.slotCorner(p))} (Man ${r(p, 'mcv')} / Zone ${r(p, 'zcv')}, Accel ${r(p, 'acc')})${/slot/i.test(p.archetype) ? ', Slot archetype' : ''}. The two starting corners already stay outside in nickel.`),
      SCORES.slotCorner, 'slot coverage', false);
  }

  // Offense
  if (has('3DRB')) finish(pkg('3DRB'), packagePicks('3DRB', inPositions(['HB']), SCORES.thirdDownBack, UNITS.BACK),
    describeFill(['HB'], 'third-down', SCORES.thirdDownBack, (p) => `Third-down score ${fmt(SCORES.thirdDownBack(p))} (Catch ${r(p, 'cth')}, Short Route ${r(p, 'srr')}, Pass Block ${r(p, 'pbk')}).`), SCORES.thirdDownBack, 'third-down', false);
  if (has('PWHB')) finish(pkg('PWHB'), packagePicks('PWHB', inPositions(['HB']), SCORES.powerBack, UNITS.BACK),
    describeFill(['HB'], 'power', SCORES.powerBack, (p) => `Power score ${fmt(SCORES.powerBack(p))} (Break Tackle ${r(p, 'btk')}, Trucking ${r(p, 'trk')}, Carry ${r(p, 'car')}).`), SCORES.powerBack, 'power running', false);
  if (has('SLWR')) {
    const outside = new Set((baseLists.get('WR') ?? []).slice(0, 2).map((pick) => pick.player.row));
    finish(pkg('SLWR'), packagePicks('SLWR', inPositions(['WR']), SCORES.slotReceiver, UNITS.REC, 0, outside),
      describeFill(['WR'], 'slot', SCORES.slotReceiver, (p) => `Slot score ${fmt(SCORES.slotReceiver(p))} (Short Route ${r(p, 'srr')}, Agility ${r(p, 'agi')}, Catch ${r(p, 'cth')}). The two outside starters stay outside.`), SCORES.slotReceiver, 'slot', false);
  }
  if (has('GAD')) finish(pkg('GAD'), packagePicks('GAD', inPositions(['WR']), SCORES.gadget, UNITS.REC),
    describeFill(['WR'], 'gadget', SCORES.gadget, (p) => `Gadget score ${fmt(SCORES.gadget(p))} (Speed ${r(p, 'spd')}, Agility ${r(p, 'agi')}, Ball-carrier Vision ${r(p, 'bcv')}).`), SCORES.gadget, 'gadget', false);

  // Special teams
  if (has('KOS')) finish(pkg('KOS'), packagePicks('KOS', inPositions(['K', 'P']), SCORES.kickoff, []),
    (p) => `Kickoff score ${fmt(SCORES.kickoff(p))} (Kick Power ${r(p, 'kpw')}, Accuracy ${r(p, 'kac')}).`, SCORES.kickoff, 'kickoff', false);
  for (const [key, score, label] of [['KR', SCORES.kickReturn, 'Kick return'], ['PR', SCORES.puntReturn, 'Punt return']] as const) {
    if (!has(key)) continue;
    const eligible = inPositions(pkg(key).positions);
    const nonStarters = eligible.filter((p) => !isStarter(p.row));
    const group = nonStarters.length >= sizeOf(key) ? nonStarters : eligible;
    finish(pkg(key), packagePicks(key, group, score, []),
      (p) => `${label} ${fmt(score(p))} (Return ${r(p, 'ret')}, Speed ${r(p, 'spd')}, Carry ${r(p, 'car')}). ${isStarter(p.row) ? 'A starter, used only because there are not enough non-starters.' : `Not a starter (${pos(p.position)}), so no starter is exposed on returns.`}`,
      score, label.toLowerCase(), false);
  }
  if (has('LS')) {
    const eligible = players.filter((p) => !['QB', 'K', 'P'].includes(p.position) && !isStarter(p.row));
    // Equal snap ratings: prefer players on no other list.
    const lsScore: Score = (p) => r(p, 'ls') + (onBaseList.has(p.row) ? 0 : 0.5);
    finish(pkg('LS'), packagePicks('LS', eligible, lsScore, []),
      (p) => `Long Snap ${r(p, 'ls')} (${pos(p.position)}${onBaseList.has(p.row) ? ', backup' : ', on no other list'}). Starters are left off so nobody plays both ways.`,
      lsScore, 'long snap', false);
  }

  // Keep the display order: base spots, then packages, grouped by side.
  const order = ALL_SLOT_KEYS;
  slots.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return { slots };
}

function injuryLabel(p: DcPlayer): string {
  const injury = p.injury!;
  const type = injury.type && !/invalid/i.test(injury.type) ? injury.type.replace(/([a-z])([A-Z])/g, '$1 $2') : 'injury';
  const weeks = injury.weeks > 0 ? `, about ${injury.weeks} week${injury.weeks === 1 ? '' : 's'}` : '';
  return `${type}${injury.reserve ? ', injured reserve' : ''}${weeks}`;
}

function baseNote(p: DcPlayer, index: number, list: DcPlayer[], def: BaseDef): string {
  const role = index < def.starters ? 'Starter' : 'Backup';
  const below = list[index + 1];
  const above = list[index - 1];
  if (above && above.ovr < p.ovr) {
    return `${role}. Behind ${above.name} (${above.ovr} overall) because they are within ${TIE_WINDOW} point and his ${def.scoreLabel} ratings are not clearly better (${fmt(def.score(p))} vs ${fmt(def.score(above))}).`;
  }
  if (below && below.ovr >= p.ovr - TIE_WINDOW && below.ovr <= p.ovr) {
    return `${role}. Ahead of ${below.name}: ${p.ovr} vs ${below.ovr} overall, ${def.scoreLabel} ratings ${fmt(def.score(p))} vs ${fmt(def.score(below))}.`;
  }
  return `${role}. ${p.ovr} overall.`;
}

function makeSlot(
  def: { key: string; label: string; help: string; side: DcSide; positions: string[]; starters: number },
  size: number,
  now: number[],
  recommended: DcEntry[],
): DcSlotPlan {
  const next = recommended.slice(0, size);
  // Lists the roster cannot fill keep their current tail, so compare only what we would write.
  const changed = next.some((entry, index) => entry.row !== now[index]);
  return {
    key: def.key, label: def.label, help: def.help, side: def.side, kind: PACKAGE_SLOTS.some((item) => item.key === def.key) ? 'package' : 'base',
    size, starters: def.starters, positions: def.positions, current: now, recommended: next, changed,
  };
}

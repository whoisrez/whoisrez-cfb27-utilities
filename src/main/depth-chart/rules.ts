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

import type { DcEntry, DcPlan, DcPlayer, DcSide, DcSlotPlan } from '../../shared/depth-chart';
import { DISPLAY_POSITION } from '../../shared/depth-chart';

export const TIE_WINDOW = 1;

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

export function buildDepthChart(input: BuildInput): DcPlan {
  const { players, sizes, current } = input;
  const inPositions = (positions: string[]) => players.filter((p) => positions.includes(p.position));
  const sizeOf = (key: string) => Math.max(0, Number(sizes[key] ?? 0));

  const baseLists = new Map<string, DcPlayer[]>();
  const notes = new Map<string, Map<number, string>>();
  const onBaseList = new Set<number>();
  const noteFor = (key: string) => {
    if (!notes.has(key)) notes.set(key, new Map());
    return notes.get(key)!;
  };

  // Pass 1: position-locked lists.
  for (const def of BASE_SLOTS) {
    if (!(def.key in sizes)) continue;
    const list = orderForSlot(inPositions(def.positions), def.score).slice(0, sizeOf(def.key));
    list.forEach((p) => onBaseList.add(p.row));
    baseLists.set(def.key, list);
  }

  // Pass 2: short groups borrow unlisted players — same unit first, then the same side.
  for (const def of BASE_SLOTS) {
    const list = baseLists.get(def.key);
    if (!list || list.length >= sizeOf(def.key)) continue;
    // Kickers and punters back each other up even when listed elsewhere: specialists never sub in blowouts.
    const specialist = def.unit === 'KP';
    for (const pool of [UNITS[def.unit], SIDE_POOL[def.side]]) {
      const spare = byScore(players.filter((p) => pool.includes(p.position)
        && !list.some((item) => item.row === p.row)
        && (specialist || !onBaseList.has(p.row))), def.score);
      for (const p of spare) {
        if (list.length >= sizeOf(def.key)) break;
        list.push(p);
        if (!specialist) onBaseList.add(p.row);
        noteFor(def.key).set(p.row, specialist
          ? `Backup ${def.label} from the ${pos(p.position)} spot (${def.scoreLabel} ${fmt(def.score(p))}). Specialists never come in as blowout subs, so sharing is safe.`
          : `Fill-in from ${pos(p.position)} (${def.scoreLabel} ${fmt(def.score(p))}): there are not enough ${def.label}s, and he is on no other list, so no starter gets pulled here.`);
      }
      if (list.length >= sizeOf(def.key)) break;
    }
  }

  const starterRows = new Set<number>();
  for (const def of BASE_SLOTS) (baseLists.get(def.key) ?? []).slice(0, def.starters).forEach((p) => starterRows.add(p.row));

  const slots: DcSlotPlan[] = [];
  for (const def of BASE_SLOTS) {
    const list = baseLists.get(def.key);
    if (!list) continue;
    const entries = list.map((p, index) => ({ row: p.row, note: noteFor(def.key).get(p.row) ?? baseNote(p, index, list, def) }));
    slots.push(makeSlot({ ...def }, sizeOf(def.key), current[def.key] ?? [], entries));
  }

  // ---- Packages ----
  const usedImports = new Set<number>();
  const pkg = (key: string) => PACKAGE_SLOTS.find((item) => item.key === key)!;
  const addPackage = (key: string, entries: DcEntry[]) => {
    if (!(key in sizes)) return;
    const def = pkg(key);
    slots.push(makeSlot(def, sizeOf(key), current[key] ?? [], entries));
  };
  /** Top up a short package from non-starters in the given positions. */
  const topUp = (entries: DcEntry[], size: number, positions: string[], score: Score, label: string) => {
    const taken = new Set(entries.map((entry) => entry.row));
    for (const p of byScore(players.filter((item) => positions.includes(item.position) && !taken.has(item.row) && !starterRows.has(item.row)), score)) {
      if (entries.length >= size) break;
      entries.push({ row: p.row, note: `Fill-in from ${pos(p.position)} (${label} ${fmt(score(p))}): the position group is too small for every spot.` });
    }
  };
  const ranked = (key: string, group: DcPlayer[], score: Score, describe: (p: DcPlayer) => string) =>
    byScore(group, score).slice(0, sizeOf(key)).map((p) => ({ row: p.row, note: describe(p) }));

  // Defense
  const edgeImports = players.filter((p) => (p.position === 'LOLB' || p.position === 'ROLB') && !starterRows.has(p.row));
  for (const [key, position] of [['RLE', 'LE'], ['RRE', 'RE']] as const) {
    if (!(key in sizes)) continue;
    const group = byScore(inPositions([position]), SCORES.passRush);
    const best = group[0];
    const candidate = byScore(edgeImports.filter((p) => !usedImports.has(p.row)), SCORES.passRush)[0];
    const entries: DcEntry[] = [];
    if (candidate && (!best || SCORES.passRush(candidate) > SCORES.passRush(best))) {
      usedImports.add(candidate.row);
      entries.push({ row: candidate.row, note: `Best pass rusher available (rush ${fmt(SCORES.passRush(candidate))} vs ${best ? fmt(SCORES.passRush(best)) : '—'} for the best ${pos(position)}). He is a backup ${pos(candidate.position)}, so this gets him snaps without moving a starter.` });
    }
    for (const p of group) {
      if (entries.length >= sizeOf(key)) break;
      entries.push({ row: p.row, note: `${pos(position)} pass rush ${fmt(SCORES.passRush(p))} (Power ${r(p, 'pmv')} / Finesse ${r(p, 'fmv')}, Block Shed ${r(p, 'bsh')}).` });
    }
    topUp(entries, sizeOf(key), UNITS.DL, SCORES.passRush, 'pass rush');
    addPackage(key, entries);
  }
  {
    const entries = ranked('RDT', inPositions(['DT']), SCORES.passRush, (p) => `Inside pass rush ${fmt(SCORES.passRush(p))} (Power ${r(p, 'pmv')} / Finesse ${r(p, 'fmv')}, Accel ${r(p, 'acc')}).`);
    topUp(entries, sizeOf('RDT'), UNITS.DL, SCORES.passRush, 'pass rush');
    addPackage('RDT', entries);
  }
  {
    const entries = ranked('NT', inPositions(['DT']), SCORES.nose, (p) => `Run fit ${fmt(SCORES.nose(p))} (${p.weight} lbs, Block Shed ${r(p, 'bsh')}, Play Rec ${r(p, 'prc')}).`);
    topUp(entries, sizeOf('NT'), UNITS.DL, SCORES.nose, 'run fit');
    addPackage('NT', entries);
  }
  {
    const entries = (baseLists.get('MLB') ?? []).slice(0, sizeOf('SUBLB'))
      .map((p, index) => ({ row: p.row, note: `Same order as MIKE #${index + 1}, so a blowout sub here is the same MIKE who would come in anyway.` }));
    topUp(entries, sizeOf('SUBLB'), UNITS.LB, SCORES.mike, 'coverage');
    addPackage('SUBLB', entries);
  }
  {
    const outside = new Set((baseLists.get('CB') ?? []).slice(0, 2).map((p) => p.row));
    const entries = ranked('SLCB', inPositions(['CB']).filter((p) => !outside.has(p.row)), SCORES.slotCorner,
      (p) => `Slot coverage ${fmt(SCORES.slotCorner(p))} (Man ${r(p, 'mcv')} / Zone ${r(p, 'zcv')}, Accel ${r(p, 'acc')})${/slot/i.test(p.archetype) ? ', Slot archetype' : ''}. The two starting corners already stay outside in nickel.`);
    topUp(entries, sizeOf('SLCB'), UNITS.DB, SCORES.slotCorner, 'slot coverage');
    addPackage('SLCB', entries);
  }

  // Offense
  {
    const entries = ranked('3DRB', inPositions(['HB']), SCORES.thirdDownBack, (p) => `Third-down score ${fmt(SCORES.thirdDownBack(p))} (Catch ${r(p, 'cth')}, Short Route ${r(p, 'srr')}, Pass Block ${r(p, 'pbk')}).`);
    topUp(entries, sizeOf('3DRB'), UNITS.BACK, SCORES.thirdDownBack, 'third-down');
    addPackage('3DRB', entries);
  }
  {
    const entries = ranked('PWHB', inPositions(['HB']), SCORES.powerBack, (p) => `Power score ${fmt(SCORES.powerBack(p))} (Break Tackle ${r(p, 'btk')}, Trucking ${r(p, 'trk')}, Carry ${r(p, 'car')}).`);
    topUp(entries, sizeOf('PWHB'), UNITS.BACK, SCORES.powerBack, 'power');
    addPackage('PWHB', entries);
  }
  {
    const outside = new Set((baseLists.get('WR') ?? []).slice(0, 2).map((p) => p.row));
    const entries = ranked('SLWR', inPositions(['WR']).filter((p) => !outside.has(p.row)), SCORES.slotReceiver,
      (p) => `Slot score ${fmt(SCORES.slotReceiver(p))} (Short Route ${r(p, 'srr')}, Agility ${r(p, 'agi')}, Catch ${r(p, 'cth')}). The two outside starters stay outside.`);
    topUp(entries, sizeOf('SLWR'), UNITS.REC, SCORES.slotReceiver, 'slot');
    addPackage('SLWR', entries);
  }
  {
    const entries = ranked('GAD', inPositions(['WR']), SCORES.gadget, (p) => `Gadget score ${fmt(SCORES.gadget(p))} (Speed ${r(p, 'spd')}, Agility ${r(p, 'agi')}, Ball-carrier Vision ${r(p, 'bcv')}).`);
    topUp(entries, sizeOf('GAD'), UNITS.REC, SCORES.gadget, 'gadget');
    addPackage('GAD', entries);
  }

  // Special teams
  addPackage('KOS', ranked('KOS', inPositions(['K', 'P']), SCORES.kickoff, (p) => `Kickoff score ${fmt(SCORES.kickoff(p))} (Kick Power ${r(p, 'kpw')}, Accuracy ${r(p, 'kac')}).`));
  const returners = (key: 'KR' | 'PR', score: Score, label: string) => {
    if (!(key in sizes)) return;
    const eligible = inPositions(pkg(key).positions);
    const ordered = [...byScore(eligible.filter((p) => !starterRows.has(p.row)), score), ...byScore(eligible.filter((p) => starterRows.has(p.row)), score)];
    addPackage(key, ordered.slice(0, sizeOf(key)).map((p) => ({
      row: p.row,
      note: `${label} ${fmt(score(p))} (Return ${r(p, 'ret')}, Speed ${r(p, 'spd')}, Carry ${r(p, 'car')}). ${starterRows.has(p.row) ? 'A starter, used only because there are not enough non-starters.' : `Not a starter (${pos(p.position)}), so no starter is exposed on returns.`}`,
    })));
  };
  returners('KR', SCORES.kickReturn, 'Kick return');
  returners('PR', SCORES.puntReturn, 'Punt return');
  if ('LS' in sizes) {
    const eligible = players.filter((p) => !['QB', 'K', 'P'].includes(p.position) && !starterRows.has(p.row));
    const ordered = [...eligible].sort((a, b) => r(b, 'ls') - r(a, 'ls') || Number(onBaseList.has(a.row)) - Number(onBaseList.has(b.row)) || b.ovr - a.ovr || a.row - b.row);
    addPackage('LS', ordered.slice(0, sizeOf('LS')).map((p) => ({
      row: p.row,
      note: `Long Snap ${r(p, 'ls')} (${pos(p.position)}${onBaseList.has(p.row) ? ', backup' : ', on no other list'}). Starters are left off so nobody plays both ways.`,
    })));
  }

  return { slots };
}

function baseNote(p: DcPlayer, index: number, list: DcPlayer[], def: BaseDef): string {
  const role = index < def.starters ? 'Starter' : 'Backup';
  const below = list[index + 1];
  const above = list[index - 1];
  if (above && above.ovr < p.ovr) {
    return `${role}. Ranked behind ${above.name} on ${def.scoreLabel} ratings (${fmt(def.score(above))} vs ${fmt(def.score(p))}) because they are within ${TIE_WINDOW} overall.`;
  }
  if (below && Math.abs(p.ovr - below.ovr) <= TIE_WINDOW) {
    return `${role}. Close on overall with ${below.name} (${p.ovr} vs ${below.ovr}); wins on ${def.scoreLabel} ratings (${fmt(def.score(p))} vs ${fmt(def.score(below))}).`;
  }
  return `${role}. ${p.ovr} overall.`;
}

function makeSlot(
  def: { key: string; label: string; help: string; side: DcSide; positions: string[]; starters: number },
  size: number,
  current: number[],
  recommended: DcEntry[],
): DcSlotPlan {
  const next = recommended.slice(0, size);
  const now = current.slice(0, size);
  // Lists the roster cannot fill keep their current tail, so compare only what we would write.
  const changed = next.some((entry, index) => entry.row !== now[index]);
  return {
    key: def.key, label: def.label, help: def.help, side: def.side, kind: PACKAGE_SLOTS.some((item) => item.key === def.key) ? 'package' : 'base',
    size, starters: def.starters, positions: def.positions, current: now, recommended: next, changed,
  };
}

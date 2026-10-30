// Depth chart rules for offense, defense and special teams.
//
// Pure logic (no Electron / save-file access): it runs in the window so any
// settings change re-ranks the chart instantly. Every number and switch below
// comes from DcSettings (depth-chart-settings.ts), so the logic is user-editable.
//
// Base positions
//   1. Position lock: a base spot is filled only with players listed at that
//      position, so blowout subs never pull a starter into a different spot.
//   2. Order: overall first, and inside the tie window the spot's weighted
//      ratings decide — or, with "Ratings only", the weighted ratings alone.
//   3. Short groups borrow players who are on no other base list: same unit
//      first, then the same side of the ball (switchable).
// Packages and special teams
//   4. Each package ranks its position group by its own formula (pass rush,
//      run fit, slot coverage, receiving back, power back, ...).
//   5. RLE/RRE #1 may be a backup SAM/WILL who out-rushes every end (switchable).
//   6. Returners and the long snapper come from non-starters first (switchable);
//      kickers and punters back each other up.
// Your chart wins ties
//   7. A spot keeps the current chart's player unless the pick is clearly better:
//      more than the tie window in overall, or more than the keep margin on the
//      spot's ratings. Out-of-position players and other spots' starters are
//      always replaced. (Switchable.)
// Injuries
//   8. Injured players keep their spot and the next healthy player plays (or,
//      if switched off, injured players drop to the bottom of their list).
// Schemes
//   9. How many players start at each defensive spot follows the scheme in the
//      save (4-3, 3-4, 4-2-5, 3-3-5, 3-2-6, Multiple) or the one picked in
//      settings, and can be overridden per spot.

import type { DcEntry, DcPlan, DcPlayer, DcSide, DcSlotPlan } from './depth-chart';
import { DISPLAY_POSITION } from './depth-chart';
import { schemeFor, startersFor, weightsFor, type DcSettings, type ScoreKey } from './depth-chart-settings';

type Score = (p: DcPlayer) => number;

type SlotDef = { key: string; label: string; help: string; side: DcSide; positions: string[] };
type BaseDef = SlotDef & { unit: string; scoreKey: ScoreKey; scoreLabel: string };

const pos = (code: string) => DISPLAY_POSITION[code] ?? code;
const fmt = (value: number) => String(Math.round(value));
const avg = (...values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const raw = (p: DcPlayer, key: string) => Number(p.ratings[key] ?? 0);

/** A rating by key, including derived ones (best move, size, averages, overall). */
export function ratingValue(p: DcPlayer, key: string): number {
  switch (key) {
    case 'moves': return Math.max(raw(p, 'pmv'), raw(p, 'fmv'));
    case 'otherMove': return Math.min(raw(p, 'pmv'), raw(p, 'fmv'));
    case 'throwAcc': return avg(raw(p, 'tas'), raw(p, 'tam'), raw(p, 'tad'));
    case 'routes': return avg(raw(p, 'srr'), raw(p, 'mrr'), raw(p, 'drr'));
    case 'pbAvg': return avg(raw(p, 'pbp'), raw(p, 'pbf'));
    case 'size': return Math.max(0, Math.min(99, ((p.weight - 230) / 100) * 99));
    case 'ovr': return p.ovr;
    default: return raw(p, key);
  }
}

/** Weighted average of the ratings in `weights` (overall if no weights are set). */
export function makeScore(weights: Record<string, number>, bonus?: Score): Score {
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  return (p) => {
    const base = total ? entries.reduce((sum, [key, weight]) => sum + weight * ratingValue(p, key), 0) / total : p.ovr;
    return base + (bonus ? bonus(p) : 0);
  };
}

// ---- Slots ------------------------------------------------------------------------------------

export const BASE_SLOTS: BaseDef[] = [
  { key: 'QB', label: 'QB', help: 'Quarterback', side: 'offense', positions: ['QB'], unit: 'QB', scoreKey: 'qb', scoreLabel: 'passing' },
  { key: 'HB', label: 'HB', help: 'Halfback', side: 'offense', positions: ['HB'], unit: 'BACK', scoreKey: 'hb', scoreLabel: 'rushing' },
  { key: 'FB', label: 'FB', help: 'Fullback', side: 'offense', positions: ['FB'], unit: 'BACK', scoreKey: 'fb', scoreLabel: 'blocking' },
  { key: 'WR', label: 'WR', help: 'Wide receiver', side: 'offense', positions: ['WR'], unit: 'REC', scoreKey: 'wr', scoreLabel: 'receiving' },
  { key: 'TE', label: 'TE', help: 'Tight end', side: 'offense', positions: ['TE'], unit: 'REC', scoreKey: 'te', scoreLabel: 'TE' },
  { key: 'LT', label: 'LT', help: 'Left tackle', side: 'offense', positions: ['LT'], unit: 'OL', scoreKey: 'tackle', scoreLabel: 'tackle' },
  { key: 'LG', label: 'LG', help: 'Left guard', side: 'offense', positions: ['LG'], unit: 'OL', scoreKey: 'interior', scoreLabel: 'blocking' },
  { key: 'C', label: 'C', help: 'Center', side: 'offense', positions: ['C'], unit: 'OL', scoreKey: 'interior', scoreLabel: 'blocking' },
  { key: 'RG', label: 'RG', help: 'Right guard', side: 'offense', positions: ['RG'], unit: 'OL', scoreKey: 'interior', scoreLabel: 'blocking' },
  { key: 'RT', label: 'RT', help: 'Right tackle', side: 'offense', positions: ['RT'], unit: 'OL', scoreKey: 'tackle', scoreLabel: 'tackle' },

  { key: 'LE', label: 'LEDG', help: 'Left edge', side: 'defense', positions: ['LE'], unit: 'DL', scoreKey: 'edge', scoreLabel: 'edge' },
  { key: 'RE', label: 'REDG', help: 'Right edge', side: 'defense', positions: ['RE'], unit: 'DL', scoreKey: 'edge', scoreLabel: 'edge' },
  { key: 'DT', label: 'DT', help: 'Defensive tackle', side: 'defense', positions: ['DT'], unit: 'DL', scoreKey: 'dt', scoreLabel: 'DT' },
  { key: 'LOLB', label: 'SAM', help: 'Strong-side linebacker', side: 'defense', positions: ['LOLB'], unit: 'LB', scoreKey: 'sam', scoreLabel: 'SAM' },
  { key: 'MLB', label: 'MIKE', help: 'Middle linebacker', side: 'defense', positions: ['MLB'], unit: 'LB', scoreKey: 'mike', scoreLabel: 'MIKE' },
  { key: 'ROLB', label: 'WILL', help: 'Weak-side linebacker', side: 'defense', positions: ['ROLB'], unit: 'LB', scoreKey: 'will', scoreLabel: 'WILL' },
  { key: 'CB', label: 'CB', help: 'Cornerback', side: 'defense', positions: ['CB'], unit: 'DB', scoreKey: 'cb', scoreLabel: 'coverage' },
  { key: 'FS', label: 'FS', help: 'Free safety', side: 'defense', positions: ['FS'], unit: 'DB', scoreKey: 'fs', scoreLabel: 'FS' },
  { key: 'SS', label: 'SS', help: 'Strong safety', side: 'defense', positions: ['SS'], unit: 'DB', scoreKey: 'ss', scoreLabel: 'SS' },

  { key: 'K', label: 'K', help: 'Kicker', side: 'special', positions: ['K'], unit: 'KP', scoreKey: 'kicker', scoreLabel: 'kicking' },
  { key: 'P', label: 'P', help: 'Punter', side: 'special', positions: ['P'], unit: 'KP', scoreKey: 'punter', scoreLabel: 'punting' },
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
const RETURN_POSITIONS = ['HB', 'FB', 'WR', 'TE', 'CB', 'FS', 'SS'];

export const PACKAGE_SLOTS: SlotDef[] = [
  { key: '3DRB', label: '3DRB', help: 'Third-down back', side: 'offense', positions: ['HB'] },
  { key: 'PWHB', label: 'PWHB', help: 'Power / goal-line back', side: 'offense', positions: ['HB'] },
  { key: 'SLWR', label: 'SLWR', help: 'Slot receiver', side: 'offense', positions: ['WR'] },
  { key: 'GAD', label: 'GAD', help: 'Gadget player', side: 'offense', positions: ['WR'] },
  { key: 'RLE', label: 'RLE', help: 'Pass-rush left end', side: 'defense', positions: ['LE'] },
  { key: 'RRE', label: 'RRE', help: 'Pass-rush right end', side: 'defense', positions: ['RE'] },
  { key: 'RDT', label: 'RDT', help: 'Pass-rush tackle', side: 'defense', positions: ['DT'] },
  { key: 'NT', label: 'NT', help: 'Nose tackle', side: 'defense', positions: ['DT'] },
  { key: 'SUBLB', label: 'SUBLB', help: 'Nickel / dime linebacker', side: 'defense', positions: ['MLB'] },
  { key: 'SLCB', label: 'SLCB', help: 'Slot corner', side: 'defense', positions: ['CB'] },
  { key: 'KOS', label: 'KOS', help: 'Kickoff specialist', side: 'special', positions: ['K', 'P'] },
  { key: 'KR', label: 'KR', help: 'Kick returner', side: 'special', positions: RETURN_POSITIONS },
  { key: 'PR', label: 'PR', help: 'Punt returner', side: 'special', positions: RETURN_POSITIONS },
  { key: 'LS', label: 'LS', help: 'Long snapper', side: 'special', positions: [] },
];

export const ALL_SLOT_KEYS: string[] = [...BASE_SLOTS.map((slot) => slot.key), ...PACKAGE_SLOTS.map((slot) => slot.key)];

// ---- Build --------------------------------------------------------------------------------

export type BuildInput = {
  players: DcPlayer[];
  /** Number of spots the game uses for each list (the save's array sizes). */
  sizes: Record<string, number>;
  /** Current depth chart rows for each list. */
  current: Record<string, number[]>;
  /** Defensive scheme stored in the save (e.g. DEF_3_4_MULTIPLE). */
  savedScheme: string;
  settings: DcSettings;
};

type Pick = { player: DcPlayer; kept: boolean };

export function buildDepthChart(input: BuildInput): DcPlan {
  const { players, sizes, current, settings } = input;
  const scheme = schemeFor(settings, input.savedScheme);
  const startersOf = (key: string) => startersFor(settings, scheme, key);
  const scoreOf = (key: ScoreKey): Score => makeScore(weightsFor(settings, key),
    key === 'slotCorner' ? (p) => (/slot/i.test(p.archetype) ? settings.slotArchetypeBonus : 0) : undefined);
  const scores = new Map<ScoreKey, Score>();
  const score = (key: ScoreKey) => {
    if (!scores.has(key)) scores.set(key, scoreOf(key));
    return scores.get(key)!;
  };

  const byRow = new Map(players.map((p) => [p.row, p]));
  const inPositions = (positions: string[]) => players.filter((p) => positions.includes(p.position));
  const sizeOf = (key: string) => Math.max(0, Number(sizes[key] ?? 0));
  const currentOf = (key: string) => current[key] ?? [];
  const useOverall = settings.orderBy === 'overall';

  const byScore = (list: DcPlayer[], s: Score) => [...list].sort((a, b) => s(b) - s(a) || b.ovr - a.ovr || a.row - b.row);

  /** Overall first with the ratings deciding inside the tie window, or ratings only. */
  const ideal = (list: DcPlayer[], s: Score) => {
    if (!useOverall) return byScore(list, s);
    const sorted = [...list].sort((a, b) => b.ovr - a.ovr || s(b) - s(a) || a.row - b.row);
    for (let i = 1; i < sorted.length; i += 1) {
      let j = i;
      while (j > 0 && Math.abs(sorted[j - 1].ovr - sorted[j].ovr) <= settings.tieWindow && s(sorted[j]) > s(sorted[j - 1]) + 1e-9) {
        [sorted[j - 1], sorted[j]] = [sorted[j], sorted[j - 1]];
        j -= 1;
      }
    }
    return sorted;
  };

  /** True when `a` should replace the current player `b`. */
  const clearlyBetter = (a: DcPlayer, b: DcPlayer, s: Score, overallMatters: boolean) => {
    if (overallMatters && useOverall && a.ovr - b.ovr > settings.tieWindow) return true;
    if (overallMatters && useOverall && b.ovr - a.ovr > settings.tieWindow) return false;
    return s(a) - s(b) > settings.keepMargin;
  };

  /** Fill spots from `order` (best first), keeping the current player where the pick is not clearly better. */
  const stablePick = (order: DcPlayer[], now: number[], size: number, s: Score, overallMatters: boolean): Pick[] => {
    const pool = new Map(order.map((p) => [p.row, p]));
    const used = new Set<number>();
    const picks: Pick[] = [];
    for (let i = 0; i < size; i += 1) {
      const best = order.find((p) => !used.has(p.row));
      if (!best) break;
      const cur = pool.get(now[i]);
      const keep = settings.keepCurrent && Boolean(cur && cur.row !== best.row && !used.has(cur.row) && !clearlyBetter(best, cur, s, overallMatters));
      const player = keep ? cur! : best;
      used.add(player.row);
      picks.push({ player, kept: keep });
    }
    return picks;
  };

  /** With "injured drop to the bottom", healthy players move ahead (in order). */
  const injuryOrder = (picks: Pick[]) => (settings.injuredKeepSpot ? picks
    : [...picks.filter((pick) => !pick.player.injury), ...picks.filter((pick) => pick.player.injury)]);

  // ---- Base lists ----
  const baseLists = new Map<string, Pick[]>();
  const fillNotes = new Map<string, Map<number, string>>();
  const onBaseList = new Set<number>();
  const fillNote = (key: string) => {
    if (!fillNotes.has(key)) fillNotes.set(key, new Map());
    return fillNotes.get(key)!;
  };

  for (const def of BASE_SLOTS) {
    if (!(def.key in sizes)) continue;
    const s = score(def.scoreKey);
    const picks = stablePick(ideal(inPositions(def.positions), s), currentOf(def.key), sizeOf(def.key), s, true);
    picks.forEach((pick) => onBaseList.add(pick.player.row));
    baseLists.set(def.key, picks);
  }

  for (const def of BASE_SLOTS) {
    const list = baseLists.get(def.key);
    if (!list || list.length >= sizeOf(def.key)) continue;
    // Kickers and punters back each other up even when listed elsewhere: specialists never sub in blowouts.
    const specialist = def.unit === 'KP';
    if (!specialist && !settings.borrowWhenShort) continue;
    const s = score(def.scoreKey);
    for (const pool of [UNITS[def.unit], SIDE_POOL[def.side]]) {
      const taken = new Set(list.map((pick) => pick.player.row));
      const spare = byScore(players.filter((p) => pool.includes(p.position) && !taken.has(p.row) && (specialist || !onBaseList.has(p.row))), s);
      for (const pick of stablePick(spare, currentOf(def.key).slice(list.length), sizeOf(def.key) - list.length, s, false)) {
        list.push(pick);
        if (!specialist) onBaseList.add(pick.player.row);
        const p = pick.player;
        fillNote(def.key).set(p.row, specialist
          ? `Backup ${def.label} from the ${pos(p.position)} spot (${def.scoreLabel} ${fmt(s(p))}). Specialists never come in as blowout subs, so sharing is safe.`
          : `Fill-in from ${pos(p.position)} (${def.scoreLabel} ${fmt(s(p))}): there are not enough ${def.label}s, and he is on no other list, so no starter gets pulled here.`);
      }
      if (list.length >= sizeOf(def.key)) break;
    }
  }
  for (const [key, picks] of baseLists) baseLists.set(key, injuryOrder(picks));

  /** Who is on the field: the first N healthy players of each starting spot. */
  const startsAt = new Map<number, string>();
  const markStarters = (key: string, label: string, picks: Pick[]) => {
    picks.filter((pick) => !pick.player.injury).slice(0, startersOf(key))
      .forEach((pick) => { if (!startsAt.has(pick.player.row)) startsAt.set(pick.player.row, label); });
  };
  for (const def of BASE_SLOTS) markStarters(def.key, def.label, baseLists.get(def.key) ?? []);
  const isStarter = (row: number) => startsAt.has(row);

  // ---- Output helpers ----
  const slots: DcSlotPlan[] = [];
  const finish = (def: SlotDef, picksIn: Pick[], describe: (p: DcPlayer, index: number) => string, s: Score, scoreLabel: string, overallMatters: boolean) => {
    const picks = injuryOrder(picksIn);
    const starters = startersOf(def.key);
    const now = currentOf(def.key).slice(0, sizeOf(def.key));
    const nextRows = picks.map((pick) => pick.player.row);
    const injuredStarters = picks.slice(0, starters).filter((pick) => pick.player.injury).map((pick) => pick.player.name);
    let healthySeen = 0;
    const entries: DcEntry[] = picks.map((pick, index) => {
      const p = pick.player;
      const coversInjury = !p.injury && index >= starters && healthySeen < starters && injuredStarters.length > 0;
      if (!p.injury) healthySeen += 1;
      const injuryNote = p.injury
        ? (settings.injuredKeepSpot ? ` Injured (${injuryLabel(p)}): keeps this spot, and the next healthy player starts until he is back.` : ` Injured (${injuryLabel(p)}): moved to the bottom until he is back.`)
        : coversInjury ? ` Plays while ${injuredStarters.join(' and ')} ${injuredStarters.length > 1 ? 'are' : 'is'} out.` : '';
      const keptNote = pick.kept ? ' Kept from your current chart: the top alternative is not clearly better.' : '';
      const entry: DcEntry = { row: p.row, note: `${describe(p, index)}${keptNote}${injuryNote}`, kept: pick.kept || undefined };
      if (now[index] !== p.row) entry.versus = versusText(def, index, p, now[index], nextRows, s, scoreLabel, overallMatters);
      return entry;
    });
    const next = entries.slice(0, sizeOf(def.key));
    slots.push({
      key: def.key, label: def.label, help: def.help, side: def.side,
      kind: PACKAGE_SLOTS.some((item) => item.key === def.key) ? 'package' : 'base',
      size: sizeOf(def.key), starters, positions: def.positions, current: now, recommended: next,
      // Lists the roster cannot fill keep their current tail, so compare only what we would write.
      changed: next.some((entry, index) => entry.row !== now[index]),
    });
  };

  function versusText(def: SlotDef, index: number, next: DcPlayer, curRow: number | undefined, nextRows: number[], s: Score, scoreLabel: string, overallMatters: boolean): string {
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
    if (cur.injury && !settings.injuredKeepSpot) return `Over ${cur.name}: he is injured, so healthy players move ahead of him.${moved}`;
    if (overallMatters && useOverall && next.ovr - cur.ovr > settings.tieWindow) return `Over ${cur.name}: ${next.ovr} overall vs ${cur.ovr}.${moved}`;
    if (whereNow >= 0 && whereNow < index) return `${cur.name} moves up to #${whereNow + 1}, so ${next.name} shifts to #${index + 1}.`;
    const a = s(next);
    const b = s(cur);
    if (a > b) return `Over ${cur.name}: better ${scoreLabel} ratings (${fmt(a)} vs ${fmt(b)}).${moved}`;
    return `Over ${cur.name}: ${next.name} fits this spot better.${moved}`;
  }

  const baseNote = (p: DcPlayer, index: number, list: DcPlayer[], def: BaseDef, s: Score) => {
    const role = index < startersOf(def.key) ? 'Starter' : 'Backup';
    if (!useOverall) return `${role}. ${def.scoreLabel} ratings ${fmt(s(p))} (${p.ovr} overall).`;
    const above = list[index - 1];
    const below = list[index + 1];
    if (above && above.ovr < p.ovr) {
      return `${role}. Behind ${above.name} (${above.ovr} overall) because they are within ${settings.tieWindow} overall and the ${def.scoreLabel} ratings put ${above.name} first (${fmt(s(above))} vs ${fmt(s(p))}).`;
    }
    if (below && below.ovr >= p.ovr - settings.tieWindow && below.ovr <= p.ovr) {
      return `${role}. Ahead of ${below.name}: ${p.ovr} vs ${below.ovr} overall, ${def.scoreLabel} ratings ${fmt(s(p))} vs ${fmt(s(below))}.`;
    }
    return `${role}. ${p.ovr} overall.`;
  };

  for (const def of BASE_SLOTS) {
    const picks = baseLists.get(def.key);
    if (!picks) continue;
    const s = score(def.scoreKey);
    const listed = picks.map((pick) => pick.player);
    finish(def, picks, (p, index) => fillNote(def.key).get(p.row) ?? baseNote(p, index, listed, def, s), s, def.scoreLabel, true);
  }

  // ---- Packages ----
  const pkg = (key: string) => PACKAGE_SLOTS.find((item) => item.key === key)!;
  const has = (key: string) => key in sizes;
  const packagePicks = (key: string, group: DcPlayer[], s: Score, topUpPositions: string[], startAt = 0, exclude = new Set<number>()): Pick[] => {
    const size = sizeOf(key) - startAt;
    const picks = stablePick(byScore(group.filter((p) => !exclude.has(p.row)), s), currentOf(key).slice(startAt), size, s, false);
    if (picks.length < size && settings.borrowWhenShort) {
      const taken = new Set([...picks.map((pick) => pick.player.row), ...exclude]);
      const spare = byScore(players.filter((p) => topUpPositions.includes(p.position) && !taken.has(p.row) && !isStarter(p.row)), s);
      picks.push(...stablePick(spare, currentOf(key).slice(startAt + picks.length), size - picks.length, s, false));
    }
    return picks;
  };
  const describeFill = (positions: string[], label: string, s: Score, text: (p: DcPlayer) => string) =>
    (p: DcPlayer) => (positions.includes(p.position) ? text(p) : `Fill-in from ${pos(p.position)} (${label} ${fmt(s(p))}): the position group is too small for every spot.`);
  const r = ratingValue;

  // Offense
  if (has('3DRB')) {
    const s = score('thirdDownBack');
    finish(pkg('3DRB'), packagePicks('3DRB', inPositions(['HB']), s, UNITS.BACK),
      describeFill(['HB'], 'third-down', s, (p) => `Third-down score ${fmt(s(p))} (Catch ${r(p, 'cth')}, Short Route ${r(p, 'srr')}, Pass Block ${r(p, 'pbk')}).`), s, 'third-down', false);
  }
  if (has('PWHB')) {
    const s = score('powerBack');
    finish(pkg('PWHB'), packagePicks('PWHB', inPositions(['HB']), s, UNITS.BACK),
      describeFill(['HB'], 'power', s, (p) => `Power score ${fmt(s(p))} (Break Tackle ${r(p, 'btk')}, Trucking ${r(p, 'trk')}, Carry ${r(p, 'car')}).`), s, 'power running', false);
  }
  if (has('SLWR')) {
    const s = score('slotReceiver');
    const outside = new Set((baseLists.get('WR') ?? []).filter((pick) => !pick.player.injury).slice(0, startersOf('WR')).map((pick) => pick.player.row));
    const picks = packagePicks('SLWR', inPositions(['WR']), s, UNITS.REC, 0, outside);
    finish(pkg('SLWR'), picks,
      describeFill(['WR'], 'slot', s, (p) => `Slot score ${fmt(s(p))} (Short Route ${r(p, 'srr')}, Agility ${r(p, 'agi')}, Catch ${r(p, 'cth')}). The outside starters stay outside.`), s, 'slot', false);
    markStarters('SLWR', 'SLWR', picks);
  }
  if (has('GAD')) {
    const s = score('gadget');
    finish(pkg('GAD'), packagePicks('GAD', inPositions(['WR']), s, UNITS.REC),
      describeFill(['WR'], 'gadget', s, (p) => `Gadget score ${fmt(s(p))} (Speed ${r(p, 'spd')}, Agility ${r(p, 'agi')}, Ball-carrier Vision ${r(p, 'bcv')}).`), s, 'gadget', false);
  }

  // Defense
  const rush = score('passRush');
  const edgeImports = settings.edgeImports ? players.filter((p) => (p.position === 'LOLB' || p.position === 'ROLB') && !isStarter(p.row)) : [];
  const usedImports = new Set<number>();
  for (const [key, position] of [['RLE', 'LE'], ['RRE', 'RE']] as const) {
    if (!has(key)) continue;
    const group = inPositions([position]);
    const best = byScore(group, rush)[0];
    const candidate = byScore(edgeImports.filter((p) => !usedImports.has(p.row)), rush)[0];
    const picks: Pick[] = [];
    if (candidate) {
      const isCurrent = currentOf(key)[0] === candidate.row;
      const keepMargin = settings.keepCurrent ? settings.keepMargin : 0;
      if (!best || rush(candidate) - rush(best) > keepMargin || (isCurrent && rush(candidate) >= rush(best))) {
        usedImports.add(candidate.row);
        picks.push({ player: candidate, kept: false });
      }
    }
    picks.push(...packagePicks(key, group, rush, UNITS.DL, picks.length));
    const lead = picks[0]?.player;
    finish(pkg(key), picks, (p) => (p === lead && !group.includes(p)
      ? `Best pass rusher available (rush ${fmt(rush(p))} vs ${best ? fmt(rush(best)) : '—'} for the best ${pos(position)}). He is a backup ${pos(p.position)}, so this gets him snaps without moving a starter.`
      : describeFill([position], 'pass rush', rush, (q) => `${pos(position)} pass rush ${fmt(rush(q))} (Power ${r(q, 'pmv')} / Finesse ${r(q, 'fmv')}, Block Shed ${r(q, 'bsh')}).`)(p)),
    rush, 'pass rush', false);
  }
  if (has('RDT')) finish(pkg('RDT'), packagePicks('RDT', inPositions(['DT']), rush, UNITS.DL),
    describeFill(['DT'], 'pass rush', rush, (p) => `Inside pass rush ${fmt(rush(p))} (Power ${r(p, 'pmv')} / Finesse ${r(p, 'fmv')}, Accel ${r(p, 'acc')}).`), rush, 'pass rush', false);
  if (has('NT')) {
    const s = score('nose');
    finish(pkg('NT'), packagePicks('NT', inPositions(['DT']), s, UNITS.DL),
      describeFill(['DT'], 'run fit', s, (p) => `Run fit ${fmt(s(p))} (${p.weight} lbs, Block Shed ${r(p, 'bsh')}, Play Rec ${r(p, 'prc')}).`), s, 'run fit', false);
  }
  if (has('SUBLB')) {
    const mike = (baseLists.get('MLB') ?? []).slice(0, sizeOf('SUBLB')).map((pick) => ({ player: pick.player, kept: false }));
    finish(pkg('SUBLB'), mike, (_p, index) => `Same order as MIKE #${index + 1}, so a blowout sub here is the same MIKE who would come in anyway.`, score('mike'), 'MIKE', false);
  }
  if (has('SLCB')) {
    const s = score('slotCorner');
    const outside = new Set((baseLists.get('CB') ?? []).filter((pick) => !pick.player.injury).slice(0, startersOf('CB')).map((pick) => pick.player.row));
    const picks = packagePicks('SLCB', inPositions(['CB']), s, UNITS.DB, 0, outside);
    finish(pkg('SLCB'), picks,
      describeFill(['CB'], 'slot coverage', s, (p) => `Slot coverage ${fmt(s(p))} (Man ${r(p, 'mcv')} / Zone ${r(p, 'zcv')}, Accel ${r(p, 'acc')})${/slot/i.test(p.archetype) ? ', Slot archetype' : ''}. The starting outside corners stay outside.`),
      s, 'slot coverage', false);
    markStarters('SLCB', 'SLCB', picks);
  }

  // Special teams
  if (has('KOS')) {
    const s = score('kickoff');
    finish(pkg('KOS'), packagePicks('KOS', inPositions(['K', 'P']), s, []),
      (p) => `Kickoff score ${fmt(s(p))} (Kick Power ${r(p, 'kpw')}, Accuracy ${r(p, 'kac')}).`, s, 'kickoff', false);
  }
  for (const [key, scoreKey, label] of [['KR', 'kickReturn', 'Kick return'], ['PR', 'puntReturn', 'Punt return']] as const) {
    if (!has(key)) continue;
    const s = score(scoreKey);
    const eligible = inPositions(RETURN_POSITIONS);
    const nonStarters = eligible.filter((p) => !isStarter(p.row));
    const group = settings.protectStartersOnSpecialTeams && nonStarters.length >= sizeOf(key) ? nonStarters : eligible;
    finish(pkg(key), packagePicks(key, group, s, []),
      (p) => `${label} ${fmt(s(p))} (Return ${r(p, 'ret')}, Speed ${r(p, 'spd')}, Carry ${r(p, 'car')}).${isStarter(p.row) ? ` Starts at ${startsAt.get(p.row)}.` : ` Not a starter (${pos(p.position)}), so no starter is exposed on returns.`}`,
      s, label.toLowerCase(), false);
  }
  if (has('LS')) {
    const eligible = players.filter((p) => !['QB', 'K', 'P'].includes(p.position) && (!settings.protectStartersOnSpecialTeams || !isStarter(p.row)));
    // Equal snap ratings: prefer players on no other list.
    const s: Score = (p) => r(p, 'ls') + (onBaseList.has(p.row) ? 0 : 0.5);
    finish(pkg('LS'), packagePicks('LS', eligible, s, []),
      (p) => `Long Snap ${r(p, 'ls')} (${pos(p.position)}${onBaseList.has(p.row) ? ', backup' : ', on no other list'}).${settings.protectStartersOnSpecialTeams ? ' Starters are left off so nobody plays both ways.' : ''}`,
      s, 'long snap', false);
  }

  slots.sort((a, b) => ALL_SLOT_KEYS.indexOf(a.key) - ALL_SLOT_KEYS.indexOf(b.key));
  return { slots, schemeId: scheme.id, schemeLabel: scheme.label };
}

function injuryLabel(p: DcPlayer): string {
  const injury = p.injury!;
  const type = injury.type && !/invalid/i.test(injury.type) ? injury.type.replace(/([a-z])([A-Z])/g, '$1 $2') : 'injury';
  const weeks = injury.weeks > 0 ? `, about ${injury.weeks} week${injury.weeks === 1 ? '' : 's'}` : '';
  return `${type}${injury.reserve ? ', injured reserve' : ''}${weeks}`;
}

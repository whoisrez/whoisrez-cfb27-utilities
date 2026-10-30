// Defensive depth chart rules.
//
// Pure logic (no Electron / madden-franchise imports) so it can be tested on its own.
// The rules mirror how the chart is built by hand:
//   1. Position lock: every base slot is filled only with players listed at that
//      position, so blowout subs never pull a starter into a different spot.
//   2. Order by overall; when two players are within TIE_WINDOW overall points,
//      the ratings that matter most for that spot break the tie.
//   3. If a position group is too small to fill every slot, the spare slots go to
//      players from the same unit (DL / LB / DB) who are on no other base list.
//   4. Sub packages use the ratings that package is for (pass rush, run fit,
//      slot coverage) and stay inside the matching position group. The only
//      exception is RLE/RRE #1: a backup SAM/WILL who out-rushes every end on
//      that side leads the package, so a top pass rusher is not stuck on the bench.

export type DcRatings = {
  spd: number; acc: number; agi: number; str: number; awr: number; tak: number;
  pow: number; pur: number; prc: number; bsh: number; pmv: number; fmv: number;
  mcv: number; zcv: number; prs: number;
};

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
};

export type SlotKey =
  | 'LE' | 'RE' | 'DT' | 'LOLB' | 'MLB' | 'ROLB' | 'CB' | 'FS' | 'SS'
  | 'RLE' | 'RRE' | 'RDT' | 'NT' | 'SUBLB' | 'SLCB';

export type DcEntry = {
  row: number;
  note: string;
};

export type DcSlotPlan = {
  key: SlotKey;
  label: string;
  kind: 'base' | 'package';
  size: number;
  starters: number;
  current: number[];
  recommended: DcEntry[];
  changed: boolean;
};

export type DcPlan = {
  slots: DcSlotPlan[];
  changedSlots: number;
};

export const TIE_WINDOW = 1;

type BaseDef = { key: SlotKey; label: string; positions: string[]; starters: number; unit: Unit; score: (p: DcPlayer) => number };
type Unit = 'DL' | 'LB' | 'DB';

const UNIT_POSITIONS: Record<Unit, string[]> = {
  DL: ['LE', 'RE', 'DT'],
  LB: ['LOLB', 'MLB', 'ROLB'],
  DB: ['CB', 'FS', 'SS'],
};

export const DISPLAY_POSITION: Record<string, string> = {
  LE: 'LEDG', RE: 'REDG', DT: 'DT', LOLB: 'SAM', MLB: 'MIKE', ROLB: 'WILL', CB: 'CB', FS: 'FS', SS: 'SS',
};

const moves = (r: DcRatings) => Math.max(r.pmv, r.fmv);
const otherMove = (r: DcRatings) => Math.min(r.pmv, r.fmv);
const weightScore = (lbs: number) => Math.max(0, Math.min(99, ((lbs - 230) / 100) * 99));

const edgeScore = (p: DcPlayer) => {
  const r = p.ratings;
  return 0.2 * moves(r) + 0.2 * r.bsh + 0.15 * r.tak + 0.15 * r.prc + 0.15 * r.acc + 0.15 * r.str;
};
const dtScore = (p: DcPlayer) => {
  const r = p.ratings;
  return 0.25 * r.bsh + 0.2 * r.str + 0.2 * moves(r) + 0.15 * r.tak + 0.1 * r.prc + 0.1 * weightScore(p.weight);
};
const samScore = (p: DcPlayer) => {
  const r = p.ratings;
  return 0.25 * r.spd + 0.25 * r.zcv + 0.15 * r.tak + 0.15 * r.prc + 0.1 * r.pur + 0.1 * r.bsh;
};
const mikeScore = (p: DcPlayer) => {
  const r = p.ratings;
  return 0.2 * r.pur + 0.2 * r.bsh + 0.2 * r.tak + 0.2 * r.zcv + 0.2 * r.prc;
};
const willScore = (p: DcPlayer) => {
  const r = p.ratings;
  return 0.2 * r.spd + 0.2 * r.zcv + 0.15 * r.mcv + 0.15 * r.tak + 0.15 * r.pur + 0.15 * r.prc;
};
const cbScore = (p: DcPlayer) => {
  const r = p.ratings;
  return 0.3 * r.mcv + 0.3 * r.zcv + 0.2 * r.spd + 0.1 * r.acc + 0.1 * r.prs;
};
const fsScore = (p: DcPlayer) => {
  const r = p.ratings;
  return 0.35 * r.zcv + 0.15 * r.mcv + 0.2 * r.spd + 0.15 * r.prc + 0.15 * r.awr;
};
const ssScore = (p: DcPlayer) => {
  const r = p.ratings;
  return 0.25 * r.zcv + 0.2 * r.tak + 0.15 * r.pur + 0.15 * r.prc + 0.15 * r.spd + 0.1 * r.mcv;
};

/** Pass-rush packages (RLE, RRE, RDT). */
export const passRushScore = (p: DcPlayer) => {
  const r = p.ratings;
  return 0.35 * moves(r) + 0.15 * otherMove(r) + 0.2 * r.bsh + 0.2 * r.acc + 0.1 * r.str;
};
/** Nose tackle: hold the point against the run. */
export const noseScore = (p: DcPlayer) => {
  const r = p.ratings;
  return 0.25 * r.bsh + 0.2 * r.str + 0.2 * r.tak + 0.2 * r.prc + 0.15 * weightScore(p.weight);
};
/** Slot corner: quickness plus balanced coverage; Slot archetypes get a small bump. */
export const slotScore = (p: DcPlayer) => {
  const r = p.ratings;
  const base = 0.25 * r.mcv + 0.25 * r.zcv + 0.2 * r.acc + 0.15 * r.spd + 0.15 * r.agi;
  return base + (/slot/i.test(p.archetype) ? 4 : 0);
};

export const BASE_SLOTS: BaseDef[] = [
  { key: 'LE', label: 'LEDG', positions: ['LE'], starters: 1, unit: 'DL', score: edgeScore },
  { key: 'RE', label: 'REDG', positions: ['RE'], starters: 1, unit: 'DL', score: edgeScore },
  { key: 'DT', label: 'DT', positions: ['DT'], starters: 2, unit: 'DL', score: dtScore },
  { key: 'LOLB', label: 'SAM', positions: ['LOLB'], starters: 1, unit: 'LB', score: samScore },
  { key: 'MLB', label: 'MIKE', positions: ['MLB'], starters: 2, unit: 'LB', score: mikeScore },
  { key: 'ROLB', label: 'WILL', positions: ['ROLB'], starters: 1, unit: 'LB', score: willScore },
  { key: 'CB', label: 'CB', positions: ['CB'], starters: 2, unit: 'DB', score: cbScore },
  { key: 'FS', label: 'FS', positions: ['FS'], starters: 1, unit: 'DB', score: fsScore },
  { key: 'SS', label: 'SS', positions: ['SS'], starters: 1, unit: 'DB', score: ssScore },
];

export const PACKAGE_SLOTS: Array<{ key: SlotKey; label: string }> = [
  { key: 'RLE', label: 'RLE' },
  { key: 'RRE', label: 'RRE' },
  { key: 'RDT', label: 'RDT' },
  { key: 'NT', label: 'NT' },
  { key: 'SUBLB', label: 'SUBLB' },
  { key: 'SLCB', label: 'SLCB' },
];

export const ALL_SLOT_KEYS: SlotKey[] = [...BASE_SLOTS.map((slot) => slot.key), ...PACKAGE_SLOTS.map((slot) => slot.key)];

/**
 * Overall first; inside TIE_WINDOW the role score decides. Implemented as a
 * stable insertion sort so the non-transitive tie rule stays deterministic.
 */
export function orderForSlot(players: DcPlayer[], score: (p: DcPlayer) => number): DcPlayer[] {
  const sorted = [...players].sort((a, b) => b.ovr - a.ovr || score(b) - score(a) || a.row - b.row);
  for (let i = 1; i < sorted.length; i += 1) {
    let j = i;
    while (j > 0) {
      const above = sorted[j - 1];
      const below = sorted[j];
      if (Math.abs(above.ovr - below.ovr) <= TIE_WINDOW && score(below) > score(above) + 1e-9) {
        sorted[j - 1] = below;
        sorted[j] = above;
        j -= 1;
      } else break;
    }
  }
  return sorted;
}

function byScore(players: DcPlayer[], score: (p: DcPlayer) => number): DcPlayer[] {
  return [...players].sort((a, b) => score(b) - score(a) || b.ovr - a.ovr || a.row - b.row);
}

function fmt(value: number): string {
  return String(Math.round(value));
}

export type BuildInput = {
  players: DcPlayer[];
  /** Number of slots the game uses for each list (from the save's array sizes). */
  sizes: Partial<Record<SlotKey, number>>;
  /** Current depth chart rows per slot, for the before/after comparison. */
  current: Partial<Record<SlotKey, number[]>>;
};

export function buildDefensiveDepthChart(input: BuildInput): DcPlan {
  const { players, sizes, current } = input;
  const byPosition = (positions: string[]) => players.filter((p) => positions.includes(p.position));
  const sizeOf = (key: SlotKey, fallback: number) => Math.max(0, Number(sizes[key] ?? fallback) || fallback);

  const baseLists = new Map<SlotKey, DcPlayer[]>();
  const baseNotes = new Map<number, string>();
  const onBaseList = new Set<number>();

  // Pass 1: position-locked base lists.
  for (const def of BASE_SLOTS) {
    const size = sizeOf(def.key, 3);
    const ordered = orderForSlot(byPosition(def.positions), def.score).slice(0, size);
    ordered.forEach((p) => onBaseList.add(p.row));
    baseLists.set(def.key, ordered);
  }

  // Pass 2: short groups borrow unlisted players from the same unit.
  for (const def of BASE_SLOTS) {
    const size = sizeOf(def.key, 3);
    const list = baseLists.get(def.key)!;
    if (list.length >= size) continue;
    const spare = byScore(
      players.filter((p) => UNIT_POSITIONS[def.unit].includes(p.position) && !onBaseList.has(p.row)),
      def.score,
    );
    for (const p of spare) {
      if (list.length >= size) break;
      list.push(p);
      onBaseList.add(p.row);
      baseNotes.set(p.row, `Fill-in from ${DISPLAY_POSITION[p.position] ?? p.position}: not on any other base list, so no starter gets pulled here.`);
    }
  }

  const starterRows = new Set<number>();
  for (const def of BASE_SLOTS) baseLists.get(def.key)!.slice(0, def.starters).forEach((p) => starterRows.add(p.row));

  const slots: DcSlotPlan[] = [];
  for (const def of BASE_SLOTS) {
    const list = baseLists.get(def.key)!;
    const entries = list.map((p, index) => ({
      row: p.row,
      note: baseNotes.get(p.row) ?? baseNote(p, index, list, def),
    }));
    slots.push(makeSlot(def.key, def.label, 'base', sizeOf(def.key, 3), def.starters, current[def.key] ?? [], entries));
  }

  // Sub packages.
  const usedImports = new Set<number>();
  const edgeImports = players.filter((p) => (p.position === 'LOLB' || p.position === 'ROLB') && !starterRows.has(p.row));

  for (const side of ['RLE', 'RRE'] as const) {
    const position = side === 'RLE' ? 'LE' : 'RE';
    const size = sizeOf(side, 3);
    const group = byScore(byPosition([position]), passRushScore);
    const bestOwn = group[0];
    const importCandidate = byScore(edgeImports.filter((p) => !usedImports.has(p.row)), passRushScore)[0];
    const entries: DcEntry[] = [];
    if (importCandidate && (!bestOwn || passRushScore(importCandidate) > passRushScore(bestOwn))) {
      usedImports.add(importCandidate.row);
      entries.push({
        row: importCandidate.row,
        note: `Best pass rusher available (rush ${fmt(passRushScore(importCandidate))} vs ${bestOwn ? fmt(passRushScore(bestOwn)) : '—'} for the best ${DISPLAY_POSITION[position]}). He is a backup ${DISPLAY_POSITION[importCandidate.position]}, so this gets him snaps without moving a starter.`,
      });
    }
    for (const p of group) {
      if (entries.length >= size) break;
      entries.push({ row: p.row, note: `${DISPLAY_POSITION[position]} pass rush ${fmt(passRushScore(p))} (Power ${p.ratings.pmv} / Finesse ${p.ratings.fmv}, Block Shed ${p.ratings.bsh}).` });
    }
    fillFromUnit(entries, size, 'DL', passRushScore, 'pass rush');
    slots.push(makeSlot(side, side, 'package', size, 1, current[side] ?? [], entries));
  }

  {
    const size = sizeOf('RDT', 3);
    const entries: DcEntry[] = byScore(byPosition(['DT']), passRushScore).slice(0, size)
      .map((p) => ({ row: p.row, note: `Inside pass rush ${fmt(passRushScore(p))} (Power ${p.ratings.pmv} / Finesse ${p.ratings.fmv}, Accel ${p.ratings.acc}).` }));
    fillFromUnit(entries, size, 'DL', passRushScore, 'pass rush');
    slots.push(makeSlot('RDT', 'RDT', 'package', size, 2, current.RDT ?? [], entries));
  }

  {
    const size = sizeOf('NT', 3);
    const entries: DcEntry[] = byScore(byPosition(['DT']), noseScore).slice(0, size)
      .map((p) => ({ row: p.row, note: `Run fit ${fmt(noseScore(p))} (${p.weight} lbs, Block Shed ${p.ratings.bsh}, Play Rec ${p.ratings.prc}).` }));
    fillFromUnit(entries, size, 'DL', noseScore, 'run fit');
    slots.push(makeSlot('NT', 'NT', 'package', size, 1, current.NT ?? [], entries));
  }

  {
    const size = sizeOf('SUBLB', 3);
    const entries: DcEntry[] = (baseLists.get('MLB') ?? []).slice(0, size)
      .map((p, index) => ({ row: p.row, note: `Same order as MIKE #${index + 1}, so a blowout sub here is the same MIKE who would come in anyway.` }));
    fillFromUnit(entries, size, 'LB', mikeScore, 'coverage');
    slots.push(makeSlot('SUBLB', 'SUBLB', 'package', size, 1, current.SUBLB ?? [], entries));
  }

  {
    const size = sizeOf('SLCB', 3);
    const cbStarters = new Set((baseLists.get('CB') ?? []).slice(0, 2).map((p) => p.row));
    const entries: DcEntry[] = byScore(byPosition(['CB']).filter((p) => !cbStarters.has(p.row)), slotScore).slice(0, size)
      .map((p) => ({ row: p.row, note: `Slot coverage ${fmt(slotScore(p))} (Man ${p.ratings.mcv} / Zone ${p.ratings.zcv}, Accel ${p.ratings.acc})${/slot/i.test(p.archetype) ? ', Slot archetype' : ''}. The two starting corners already stay on the field in nickel.` }));
    fillFromUnit(entries, size, 'DB', slotScore, 'slot coverage');
    slots.push(makeSlot('SLCB', 'SLCB', 'package', size, 1, current.SLCB ?? [], entries));
  }

  return { slots, changedSlots: slots.filter((slot) => slot.changed).length };

  function fillFromUnit(entries: DcEntry[], size: number, unit: Unit, score: (p: DcPlayer) => number, label: string): void {
    if (entries.length >= size) return;
    const taken = new Set(entries.map((entry) => entry.row));
    const spare = byScore(players.filter((p) => UNIT_POSITIONS[unit].includes(p.position) && !taken.has(p.row) && !starterRows.has(p.row)), score);
    for (const p of spare) {
      if (entries.length >= size) break;
      entries.push({ row: p.row, note: `Fill-in (${label} ${fmt(score(p))}): position group is too small for every slot.` });
    }
  }
}

function baseNote(p: DcPlayer, index: number, list: DcPlayer[], def: BaseDef): string {
  const neighbor = list[index + 1];
  const above = list[index - 1];
  const role = index < def.starters ? 'Starter' : 'Backup';
  if (neighbor && Math.abs(p.ovr - neighbor.ovr) <= TIE_WINDOW) {
    return `${role}. Close on overall with ${neighbor.name} (${p.ovr} vs ${neighbor.ovr}); wins on ${def.label} ratings (${Math.round(def.score(p))} vs ${Math.round(def.score(neighbor))}).`;
  }
  if (above && above.ovr < p.ovr) {
    return `${role}. Ranked behind ${above.name} on ${def.label} ratings (${Math.round(def.score(above))} vs ${Math.round(def.score(p))}).`;
  }
  return `${role}. ${p.ovr} overall.`;
}

function makeSlot(key: SlotKey, label: string, kind: 'base' | 'package', size: number, starters: number, current: number[], recommended: DcEntry[]): DcSlotPlan {
  const trimmed = recommended.slice(0, size);
  const currentTrimmed = current.slice(0, size);
  const changed = trimmed.length !== currentTrimmed.length || trimmed.some((entry, index) => entry.row !== currentTrimmed[index]);
  return { key, label, kind, size, starters, current: currentTrimmed, recommended: trimmed, changed };
}

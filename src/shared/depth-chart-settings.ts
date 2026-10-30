// Editable depth chart logic: rating weights, starters per scheme, and rule switches.
// Everything here is plain data so it can be saved, copied and shared.

export type ScoreKey =
  | 'edge' | 'dt' | 'sam' | 'mike' | 'will' | 'cb' | 'fs' | 'ss' | 'passRush' | 'nose' | 'slotCorner'
  | 'qb' | 'hb' | 'fb' | 'wr' | 'te' | 'tackle' | 'interior' | 'thirdDownBack' | 'powerBack' | 'slotReceiver' | 'gadget'
  | 'kicker' | 'punter' | 'kickoff' | 'kickReturn' | 'puntReturn';

export type Weights = Record<string, number>;

export type DcSettings = {
  version: 1;
  /** 'auto' follows the scheme stored in the save. */
  defenseScheme: string;
  /** 'overall': overall first, ratings break ties. 'ratings': the weighted ratings alone decide. */
  orderBy: 'overall' | 'ratings';
  /** Overall points inside which the ratings score decides. */
  tieWindow: number;
  /** Keep the current chart's player unless the pick is clearly better. */
  keepCurrent: boolean;
  /** How much better (ratings-score points) a pick must be to replace the current player. */
  keepMargin: number;
  /** Short position groups borrow players who are on no other list. */
  borrowWhenShort: boolean;
  /** A backup SAM/WILL can lead RLE/RRE when he out-rushes every end on that side. */
  edgeImports: boolean;
  /** Returners and long snapper come from non-starters first. */
  protectStartersOnSpecialTeams: boolean;
  /** Injured players keep their spot (true) or drop to the bottom of their list (false). */
  injuredKeepSpot: boolean;
  /** Extra points for Slot-archetype corners in SLCB. */
  slotArchetypeBonus: number;
  /** Starters per spot, on top of the scheme's defaults. Missing keys use the scheme. */
  starters: Record<string, number>;
  /** Rating weights per formula. Missing formulas use the defaults. */
  weights: Partial<Record<ScoreKey, Weights>>;
};

/** Rating keys → labels. Derived keys (best move, size, averages) are computed from the save's ratings. */
export const RATING_LABELS: Record<string, string> = {
  spd: 'Speed', acc: 'Acceleration', agi: 'Agility', cod: 'Change of Direction', str: 'Strength', awr: 'Awareness',
  jmp: 'Jumping', sta: 'Stamina', tgh: 'Toughness', inj: 'Injury',
  tak: 'Tackle', pow: 'Hit Power', pur: 'Pursuit', prc: 'Play Recognition', bsh: 'Block Shedding',
  pmv: 'Power Moves', fmv: 'Finesse Moves', moves: 'Best Pass-Rush Move', otherMove: 'Other Pass-Rush Move',
  mcv: 'Man Coverage', zcv: 'Zone Coverage', prs: 'Press',
  thp: 'Throw Power', tas: 'Short Accuracy', tam: 'Medium Accuracy', tad: 'Deep Accuracy', throwAcc: 'Throw Accuracy (avg)',
  tup: 'Throw Under Pressure', tor: 'Throw on the Run', pac: 'Play Action', bsk: 'Break Sack',
  car: 'Carrying', bcv: 'Ball-Carrier Vision', btk: 'Break Tackle', trk: 'Trucking', jkm: 'Juke Move', spm: 'Spin Move', sfa: 'Stiff Arm',
  cth: 'Catching', cit: 'Catch in Traffic', spc: 'Spectacular Catch', rls: 'Release',
  srr: 'Short Route Running', mrr: 'Medium Route Running', drr: 'Deep Route Running', routes: 'Route Running (avg)',
  pbk: 'Pass Block', pbp: 'Pass Block Power', pbf: 'Pass Block Finesse', pbAvg: 'Pass Block Power/Finesse (avg)',
  rbk: 'Run Block', rbp: 'Run Block Power', rbf: 'Run Block Finesse', lbk: 'Lead Block', ibl: 'Impact Blocking',
  kpw: 'Kick Power', kac: 'Kick Accuracy', ret: 'Kick Return', ls: 'Long Snap',
  size: 'Size (weight)', ovr: 'Overall',
};

export const SCORE_LABELS: Record<ScoreKey, string> = {
  edge: 'LEDG / REDG', dt: 'DT', sam: 'SAM', mike: 'MIKE (and SUBLB)', will: 'WILL', cb: 'CB', fs: 'FS', ss: 'SS',
  passRush: 'Pass rush (RLE, RRE, RDT)', nose: 'NT run fit', slotCorner: 'SLCB slot corner',
  qb: 'QB', hb: 'HB', fb: 'FB', wr: 'WR', te: 'TE', tackle: 'LT / RT', interior: 'LG / C / RG',
  thirdDownBack: '3DRB third-down back', powerBack: 'PWHB power back', slotReceiver: 'SLWR slot receiver', gadget: 'GAD gadget',
  kicker: 'K', punter: 'P', kickoff: 'KOS kickoff', kickReturn: 'KR kick return', puntReturn: 'PR punt return',
};

export const SCORE_GROUPS: Array<{ label: string; keys: ScoreKey[] }> = [
  { label: 'Offense', keys: ['qb', 'hb', 'fb', 'wr', 'te', 'tackle', 'interior', 'thirdDownBack', 'powerBack', 'slotReceiver', 'gadget'] },
  { label: 'Defense', keys: ['edge', 'dt', 'sam', 'mike', 'will', 'cb', 'fs', 'ss', 'passRush', 'nose', 'slotCorner'] },
  { label: 'Special Teams', keys: ['kicker', 'punter', 'kickoff', 'kickReturn', 'puntReturn'] },
];

/** Default weights (they are relative; each formula is a weighted average of the ratings it uses). */
export const DEFAULT_WEIGHTS: Record<ScoreKey, Weights> = {
  edge: { moves: 20, bsh: 20, tak: 15, prc: 15, acc: 15, str: 15 },
  dt: { bsh: 25, str: 20, moves: 20, tak: 15, prc: 10, size: 10 },
  sam: { spd: 25, zcv: 25, tak: 15, prc: 15, pur: 10, bsh: 10 },
  mike: { pur: 20, bsh: 20, tak: 20, zcv: 20, prc: 20 },
  will: { spd: 20, zcv: 20, mcv: 15, tak: 15, pur: 15, prc: 15 },
  cb: { mcv: 30, zcv: 30, spd: 20, acc: 10, prs: 10 },
  fs: { zcv: 35, mcv: 15, spd: 20, prc: 15, awr: 15 },
  ss: { zcv: 25, tak: 20, pur: 15, prc: 15, spd: 15, mcv: 10 },
  passRush: { moves: 35, otherMove: 15, bsh: 20, acc: 20, str: 10 },
  nose: { bsh: 25, str: 20, tak: 20, prc: 20, size: 15 },
  slotCorner: { mcv: 25, zcv: 25, acc: 20, spd: 15, agi: 15 },
  qb: { throwAcc: 30, thp: 20, tup: 20, awr: 20, spd: 10 },
  hb: { bcv: 20, spd: 20, acc: 15, btk: 15, car: 10, cth: 10, jkm: 10 },
  fb: { lbk: 30, rbk: 25, ibl: 20, str: 15, pbk: 10 },
  wr: { spd: 20, cth: 20, routes: 20, rls: 15, cit: 15, agi: 10 },
  te: { cth: 25, rbk: 20, pbk: 15, srr: 15, spd: 15, cit: 10 },
  tackle: { pbk: 35, rbk: 25, str: 15, awr: 15, pbAvg: 10 },
  interior: { rbk: 30, pbk: 30, str: 20, awr: 20 },
  thirdDownBack: { cth: 30, srr: 25, pbk: 25, spd: 10, car: 10 },
  powerBack: { btk: 30, trk: 25, car: 20, str: 15, bcv: 10 },
  slotReceiver: { srr: 30, agi: 20, cth: 20, rls: 15, acc: 15 },
  gadget: { spd: 25, acc: 20, agi: 20, bcv: 20, car: 15 },
  kicker: { kpw: 50, kac: 50 },
  punter: { kpw: 55, kac: 45 },
  kickoff: { kpw: 70, kac: 30 },
  kickReturn: { ret: 40, spd: 20, acc: 15, car: 15, bcv: 10 },
  puntReturn: { ret: 40, cth: 20, agi: 15, car: 15, acc: 10 },
};

/** Starter counts for the base defensive spots (plus the nickel corner) in each scheme. */
export type SchemeDef = { id: string; label: string; starters: Record<string, number> };

const FOUR_THREE = { LE: 1, RE: 1, DT: 2, LOLB: 1, MLB: 1, ROLB: 1, CB: 2, FS: 1, SS: 1, SLCB: 0 };
const THREE_FOUR = { LE: 1, RE: 1, DT: 1, LOLB: 1, MLB: 2, ROLB: 1, CB: 2, FS: 1, SS: 1, SLCB: 0 };

export const DEFENSE_SCHEMES: SchemeDef[] = [
  { id: 'DEF_BASE4_3', label: 'Base 4-3', starters: FOUR_THREE },
  { id: 'DEF_4_3_MULTIPLE', label: '4-3 Multiple', starters: FOUR_THREE },
  { id: 'DEF_BASE3_4', label: 'Base 3-4', starters: THREE_FOUR },
  { id: 'DEF_3_4_MULTIPLE', label: '3-4 Multiple', starters: THREE_FOUR },
  { id: 'DEF_4_2_5', label: '4-2-5', starters: { ...FOUR_THREE, LOLB: 0, SLCB: 1 } },
  { id: 'DEF_3_3_5', label: '3-3-5', starters: { ...THREE_FOUR, MLB: 1, SLCB: 1 } },
  { id: 'DEF_3_3_5_TITE', label: '3-3-5 Tite', starters: { ...THREE_FOUR, MLB: 1, SLCB: 1 } },
  { id: 'DEF_3_2_6', label: '3-2-6', starters: { ...THREE_FOUR, LOLB: 0, ROLB: 0, SLCB: 1 } },
  // Multiple lines up in both fronts, so it protects both sets of starters.
  { id: 'DEF_MULTIPLE_DEFENSE', label: 'Multiple Defense', starters: { ...FOUR_THREE, MLB: 2 } },
];

export const OFFENSE_STARTERS: Record<string, number> = { QB: 1, HB: 1, FB: 1, WR: 2, TE: 1, LT: 1, LG: 1, C: 1, RG: 1, RT: 1, SLWR: 1, K: 1, P: 1 };

export const DEFAULT_SETTINGS: DcSettings = {
  version: 1,
  defenseScheme: 'auto',
  orderBy: 'overall',
  tieWindow: 1,
  keepCurrent: true,
  keepMargin: 2.5,
  borrowWhenShort: true,
  edgeImports: true,
  protectStartersOnSpecialTeams: true,
  injuredKeepSpot: true,
  slotArchetypeBonus: 4,
  starters: {},
  weights: {},
};

/** Quick ways to lean every formula toward one trait. */
export const PRESETS: Array<{ id: string; label: string; ratings: string[] }> = [
  { id: 'speed', label: 'Speed first', ratings: ['spd', 'acc'] },
  { id: 'strength', label: 'Strength first', ratings: ['str'] },
  { id: 'iq', label: 'Football IQ first', ratings: ['awr', 'prc'] },
];

export function schemeFor(settings: DcSettings, savedScheme: string): SchemeDef {
  const id = settings.defenseScheme === 'auto' ? savedScheme : settings.defenseScheme;
  return DEFENSE_SCHEMES.find((scheme) => scheme.id === id) ?? DEFENSE_SCHEMES.find((scheme) => scheme.id === 'DEF_MULTIPLE_DEFENSE')!;
}

/** Starter count for a spot: user override, else scheme (defense), else offense/special default. */
export function startersFor(settings: DcSettings, scheme: SchemeDef, key: string): number {
  const override = settings.starters[key];
  if (Number.isFinite(override)) return Math.max(0, Math.round(override));
  if (key in scheme.starters) return scheme.starters[key];
  return OFFENSE_STARTERS[key] ?? (['RLE', 'RRE', 'NT', 'SUBLB', '3DRB', 'PWHB', 'GAD', 'KOS', 'KR', 'PR', 'LS'].includes(key) ? 1 : key === 'RDT' ? 2 : 0);
}

export function weightsFor(settings: DcSettings, key: ScoreKey): Weights {
  return settings.weights[key] ?? DEFAULT_WEIGHTS[key];
}

/** Accept saved/pasted settings, filling anything missing or invalid with defaults. */
export function normalizeSettings(value: unknown): DcSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<DcSettings>;
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const weights: DcSettings['weights'] = {};
  for (const key of Object.keys(DEFAULT_WEIGHTS) as ScoreKey[]) {
    const source = raw.weights?.[key];
    if (!source || typeof source !== 'object') continue;
    const clean: Weights = {};
    for (const [rating, weight] of Object.entries(source)) {
      const n = Number(weight);
      if (rating in RATING_LABELS && Number.isFinite(n) && n > 0) clean[rating] = Math.min(100, n);
    }
    weights[key] = clean;
  }
  const starters: Record<string, number> = {};
  for (const [key, count] of Object.entries(raw.starters ?? {})) {
    const n = Number(count);
    if (Number.isFinite(n)) starters[key] = Math.min(6, Math.max(0, Math.round(n)));
  }
  return {
    version: 1,
    defenseScheme: typeof raw.defenseScheme === 'string' && (raw.defenseScheme === 'auto' || DEFENSE_SCHEMES.some((s) => s.id === raw.defenseScheme)) ? raw.defenseScheme : 'auto',
    orderBy: raw.orderBy === 'ratings' ? 'ratings' : 'overall',
    tieWindow: num(raw.tieWindow, DEFAULT_SETTINGS.tieWindow, 0, 10),
    keepCurrent: bool(raw.keepCurrent, DEFAULT_SETTINGS.keepCurrent),
    keepMargin: num(raw.keepMargin, DEFAULT_SETTINGS.keepMargin, 0, 20),
    borrowWhenShort: bool(raw.borrowWhenShort, DEFAULT_SETTINGS.borrowWhenShort),
    edgeImports: bool(raw.edgeImports, DEFAULT_SETTINGS.edgeImports),
    protectStartersOnSpecialTeams: bool(raw.protectStartersOnSpecialTeams, DEFAULT_SETTINGS.protectStartersOnSpecialTeams),
    injuredKeepSpot: bool(raw.injuredKeepSpot, DEFAULT_SETTINGS.injuredKeepSpot),
    slotArchetypeBonus: num(raw.slotArchetypeBonus, DEFAULT_SETTINGS.slotArchetypeBonus, 0, 20),
    starters,
    weights,
  };
}

/** Add `boost` to the given ratings in every formula (used by the presets). */
export function applyPreset(settings: DcSettings, ratings: string[], boost = 20): DcSettings {
  const weights: DcSettings['weights'] = {};
  for (const key of Object.keys(DEFAULT_WEIGHTS) as ScoreKey[]) {
    const next = { ...weightsFor(settings, key) };
    for (const rating of ratings) next[rating] = Math.min(100, (next[rating] ?? 0) + boost);
    weights[key] = next;
  }
  return { ...settings, weights };
}

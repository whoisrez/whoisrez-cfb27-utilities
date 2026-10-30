// Reads and writes the defensive depth chart in a CFB 27 dynasty save.
//
// Save layout (verified on a CFB 27 dynasty file):
//   Team.DepthChart  -> DepthChart record (one per team)
//   DepthChart.<KEY> -> Player[] array record (LE, RE, DT, LOLB, MLB, ROLB, CB, FS, SS,
//                       RLE, RRE, RDT, NT, SUBLB, SLCB, ...)
//   Each array has a fixed capacity; the table's arraySizes[row] is the number of
//   slots the game actually uses (the slot count you see in the in-game depth chart).
// Only existing slots are rewritten. Arrays are never resized.

import Franchise from 'madden-franchise';
import {
  ALL_SLOT_KEYS,
  buildDefensiveDepthChart,
  type DcPlan,
  type DcPlayer,
  type SlotKey,
} from './depth-chart-rules';

type ReferenceData = { tableId: number; rowNumber: number };
type FieldLike = {
  key?: string;
  value?: unknown;
  isReference?: boolean;
  referenceData?: { tableId?: number; rowNumber?: number } | null;
};
type RecordLike = Record<string, unknown> & {
  index?: number;
  isEmpty?: boolean;
  fields?: Record<string, FieldLike>;
  fieldsArray?: FieldLike[];
};
type TableLike = {
  header: { tableId?: number; recordCapacity: number };
  records: RecordLike[];
  recordsRead?: boolean;
  arraySizes?: number[];
  readRecords: (attributes?: string[]) => Promise<void>;
};
type FranchiseLike = {
  getAllTablesByName: (name: string) => TableLike[];
  getTableById: (id: number) => TableLike;
  save: (output?: string) => Promise<void>;
};

export type DcTeamOption = { teamIndex: number; teamName: string; isUserControlled: boolean };

export type DcPlayerView = DcPlayer & {
  displayPosition: string;
  abilities: string[];
};

export type DepthChartLoad = {
  filePath: string;
  teams: DcTeamOption[];
  teamIndex: number;
  teamName: string;
  players: DcPlayerView[];
  /** Every player row referenced by the current chart (may include non-defenders). */
  others: Array<{ row: number; name: string; position: string; ovr: number }>;
  plan: DcPlan;
};

export type DepthChartWriteRequest = {
  teamIndex: number;
  slots: Array<{ key: SlotKey; rows: number[] }>;
};

export type DepthChartWriteResult = { writtenSlots: number; writtenEntries: number };

const DEFENSIVE_POSITIONS = ['LE', 'RE', 'DT', 'LOLB', 'MLB', 'ROLB', 'CB', 'FS', 'SS'];
const DISPLAY: Record<string, string> = {
  LE: 'LEDG', RE: 'REDG', DT: 'DT', LOLB: 'SAM', MLB: 'MIKE', ROLB: 'WILL', CB: 'CB', FS: 'FS', SS: 'SS',
};

function largestTable(franchise: FranchiseLike, name: string): TableLike {
  const tables = franchise.getAllTablesByName(name) ?? [];
  if (!tables.length) throw new Error(`No table found named "${name}".`);
  return tables.reduce((best, table) => table.header.recordCapacity > best.header.recordCapacity ? table : best);
}

async function readTable(table: TableLike): Promise<TableLike> {
  if (!table.recordsRead) await table.readRecords();
  return table;
}

function num(record: RecordLike, key: string, fallback = 0): number {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : fallback;
}

function str(record: RecordLike, key: string): string {
  return String(record[key] ?? '').trim();
}

function rowOf(record: RecordLike, fallback: number): number {
  return Number.isFinite(Number(record.index)) ? Number(record.index) : fallback;
}

function decodeRef32(value: unknown): ReferenceData | null {
  const text = String(value ?? '');
  if (!/^[01]{32}$/.test(text)) return null;
  const tableId = Number.parseInt(text.slice(0, 15), 2);
  const rowNumber = Number.parseInt(text.slice(15), 2);
  if (!tableId || rowNumber < 0) return null;
  return { tableId, rowNumber };
}

function encodeRef32(tableId: number, rowNumber: number): string {
  if (!Number.isInteger(tableId) || tableId <= 0 || tableId >= 2 ** 15) throw new Error(`Invalid reference table ID ${tableId}.`);
  if (!Number.isInteger(rowNumber) || rowNumber < 0 || rowNumber >= 2 ** 17) throw new Error(`Invalid reference row ${rowNumber}.`);
  return `${tableId.toString(2).padStart(15, '0')}${rowNumber.toString(2).padStart(17, '0')}`;
}

function fieldRef(field: FieldLike | undefined): ReferenceData | null {
  if (!field) return null;
  if (field.isReference && field.referenceData) {
    const tableId = Number(field.referenceData.tableId ?? 0);
    const rowNumber = Number(field.referenceData.rowNumber ?? -1);
    if (tableId > 0 && rowNumber >= 0) return { tableId, rowNumber };
  }
  return decodeRef32(field.value);
}

function teamDisplayName(record: RecordLike): string {
  return str(record, 'DisplayName') || str(record, 'LongName') || str(record, 'ShortName');
}

function isUserTeam(record: RecordLike): boolean {
  const ref = fieldRef(record.fields?.UserCharacter);
  return Boolean(ref && ref.tableId > 0);
}

type Context = {
  franchise: FranchiseLike;
  teamTable: TableLike;
  playerTable: TableLike;
  playerTableId: number;
};

async function open(filePath: string): Promise<Context> {
  const franchise = (await Franchise.create(filePath)) as unknown as FranchiseLike;
  const teamTable = await readTable(largestTable(franchise, 'Team'));
  const playerTable = await readTable(largestTable(franchise, 'Player'));
  const playerTableId = Number(playerTable.header.tableId ?? 0);
  if (!playerTableId) throw new Error('Player table ID was not available.');
  return { franchise, teamTable, playerTable, playerTableId };
}

function teamOptions(teamTable: TableLike): DcTeamOption[] {
  const options: DcTeamOption[] = [];
  for (const record of teamTable.records) {
    if (!record || record.isEmpty) continue;
    const name = teamDisplayName(record);
    const teamIndex = num(record, 'TeamIndex', -1);
    if (!name || teamIndex < 0 || /^practice$/i.test(name)) continue;
    options.push({ teamIndex, teamName: name, isUserControlled: isUserTeam(record) });
  }
  options.sort((a, b) => Number(b.isUserControlled) - Number(a.isUserControlled) || a.teamName.localeCompare(b.teamName));
  return options;
}

function findTeam(teamTable: TableLike, teamIndex: number): RecordLike {
  const record = teamTable.records.find((item) => item && !item.isEmpty && num(item, 'TeamIndex', -1) === teamIndex);
  if (!record) throw new Error(`Team ${teamIndex} was not found in the save.`);
  return record;
}

type SlotArray = { key: SlotKey; record: RecordLike; size: number; rows: number[] };

async function readDepthChartArrays(ctx: Context, team: RecordLike): Promise<Map<SlotKey, SlotArray>> {
  const chartRef = fieldRef(team.fields?.DepthChart);
  if (!chartRef) throw new Error(`${teamDisplayName(team)} has no depth chart in this save.`);
  const chartTable = await readTable(ctx.franchise.getTableById(chartRef.tableId));
  const chart = chartTable.records[chartRef.rowNumber];
  if (!chart || chart.isEmpty) throw new Error('The team depth chart record is empty.');

  const arrays = new Map<SlotKey, SlotArray>();
  for (const key of ALL_SLOT_KEYS) {
    const ref = fieldRef(chart.fields?.[key]);
    if (!ref) continue;
    const arrayTable = await readTable(ctx.franchise.getTableById(ref.tableId));
    const record = arrayTable.records[ref.rowNumber];
    if (!record || record.isEmpty) continue;
    const fields = record.fieldsArray ?? [];
    const rows: number[] = [];
    for (const field of fields) {
      const item = fieldRef(field);
      if (!item || item.tableId !== ctx.playerTableId) break;
      rows.push(item.rowNumber);
    }
    const declared = Number(arrayTable.arraySizes?.[ref.rowNumber]);
    const size = Number.isFinite(declared) && declared > 0 ? Math.min(declared, fields.length) : rows.length;
    arrays.set(key, { key, record, size, rows: rows.slice(0, size) });
  }
  return arrays;
}

function toPlayer(record: RecordLike, row: number): DcPlayerView {
  const position = str(record, 'Position');
  const abilities: string[] = [];
  for (let i = 1; i <= 5; i += 1) {
    const tier = str(record, `PhysicalAbility${i}`);
    if (tier && tier !== 'None') abilities.push(tier);
  }
  return {
    row,
    name: `${str(record, 'FirstName')} ${str(record, 'LastName')}`.trim(),
    position,
    displayPosition: DISPLAY[position] ?? position,
    jersey: num(record, 'JerseyNum'),
    ovr: num(record, 'OverallRating'),
    archetype: str(record, 'PlayerType'),
    year: str(record, 'SchoolYear'),
    dev: str(record, 'TraitDevelopment'),
    weight: num(record, 'Weight') + 160,
    abilities,
    ratings: {
      spd: num(record, 'SpeedRating'), acc: num(record, 'AccelerationRating'), agi: num(record, 'AgilityRating'),
      str: num(record, 'StrengthRating'), awr: num(record, 'AwarenessRating'), tak: num(record, 'TackleRating'),
      pow: num(record, 'HitPowerRating'), pur: num(record, 'PursuitRating'), prc: num(record, 'PlayRecognitionRating'),
      bsh: num(record, 'BlockSheddingRating'), pmv: num(record, 'PowerMovesRating'), fmv: num(record, 'FinesseMovesRating'),
      mcv: num(record, 'ManCoverageRating'), zcv: num(record, 'ZoneCoverageRating'), prs: num(record, 'PressRating'),
    },
  };
}

export async function loadDepthChart(filePath: string, requestedTeamIndex?: number | null): Promise<DepthChartLoad> {
  const ctx = await open(filePath);
  const teams = teamOptions(ctx.teamTable);
  if (!teams.length) throw new Error('No teams were found in this save.');
  const teamIndex = requestedTeamIndex != null && teams.some((team) => team.teamIndex === requestedTeamIndex)
    ? requestedTeamIndex
    : (teams.find((team) => team.isUserControlled) ?? teams[0]).teamIndex;
  const team = findTeam(ctx.teamTable, teamIndex);

  const players: DcPlayerView[] = [];
  ctx.playerTable.records.forEach((record, fallback) => {
    if (!record || record.isEmpty) return;
    if (num(record, 'TeamIndex', -1) !== teamIndex) return;
    if (!DEFENSIVE_POSITIONS.includes(str(record, 'Position'))) return;
    if (!str(record, 'LastName')) return;
    players.push(toPlayer(record, rowOf(record, fallback)));
  });
  if (!players.length) throw new Error(`No defensive players were found for ${teamDisplayName(team)}.`);

  const arrays = await readDepthChartArrays(ctx, team);
  const sizes: Partial<Record<SlotKey, number>> = {};
  const current: Partial<Record<SlotKey, number[]>> = {};
  for (const [key, slot] of arrays) {
    sizes[key] = slot.size;
    current[key] = slot.rows;
  }

  const known = new Set(players.map((player) => player.row));
  const others: DepthChartLoad['others'] = [];
  for (const slot of arrays.values()) {
    for (const row of slot.rows) {
      if (known.has(row)) continue;
      known.add(row);
      const record = ctx.playerTable.records[row];
      if (!record || record.isEmpty) continue;
      others.push({ row, name: `${str(record, 'FirstName')} ${str(record, 'LastName')}`.trim(), position: str(record, 'Position'), ovr: num(record, 'OverallRating') });
    }
  }

  const plan = buildDefensiveDepthChart({ players, sizes, current });
  return { filePath, teams, teamIndex, teamName: teamDisplayName(team), players, others, plan };
}

function validateRequest(request: DepthChartWriteRequest, arrays: Map<SlotKey, SlotArray>, teamPlayers: Set<number>): void {
  if (!request.slots.length) throw new Error('No depth chart slots were provided.');
  for (const slot of request.slots) {
    if (!ALL_SLOT_KEYS.includes(slot.key)) throw new Error(`Unsupported depth chart slot ${slot.key}.`);
    const target = arrays.get(slot.key);
    if (!target) throw new Error(`${slot.key} was not found in this team's depth chart.`);
    if (slot.rows.length > target.size) throw new Error(`${slot.key} has ${target.size} slots but ${slot.rows.length} players were provided.`);
    if (new Set(slot.rows).size !== slot.rows.length) throw new Error(`${slot.key} lists the same player twice.`);
    for (const row of slot.rows) {
      if (!teamPlayers.has(row)) throw new Error(`${slot.key}: player row ${row} is not on this team.`);
    }
  }
}

export async function writeDepthChart(inputPath: string, outputPath: string, request: DepthChartWriteRequest): Promise<DepthChartWriteResult> {
  const ctx = await open(inputPath);
  const team = findTeam(ctx.teamTable, request.teamIndex);
  const arrays = await readDepthChartArrays(ctx, team);
  const teamPlayers = new Set<number>();
  ctx.playerTable.records.forEach((record, fallback) => {
    if (record && !record.isEmpty && num(record, 'TeamIndex', -1) === request.teamIndex) teamPlayers.add(rowOf(record, fallback));
  });
  validateRequest(request, arrays, teamPlayers);

  let writtenSlots = 0;
  let writtenEntries = 0;
  for (const slot of request.slots) {
    const target = arrays.get(slot.key)!;
    const fields = target.record.fieldsArray ?? [];
    slot.rows.forEach((row, index) => {
      const field = fields[index];
      if (!field) throw new Error(`${slot.key}: slot ${index + 1} does not exist.`);
      const encoded = encodeRef32(ctx.playerTableId, row);
      field.value = encoded;
      if (field.key) target.record[field.key] = encoded;
      writtenEntries += 1;
    });
    writtenSlots += 1;
  }

  await ctx.franchise.save(outputPath);
  return { writtenSlots, writtenEntries };
}

/** Re-open a written save and confirm every requested slot reads back exactly. */
export async function verifyDepthChart(filePath: string, request: DepthChartWriteRequest): Promise<number> {
  const ctx = await open(filePath);
  const team = findTeam(ctx.teamTable, request.teamIndex);
  const arrays = await readDepthChartArrays(ctx, team);
  const failures: string[] = [];
  let verified = 0;
  for (const slot of request.slots) {
    const actual = arrays.get(slot.key)?.rows ?? [];
    const matches = slot.rows.every((row, index) => actual[index] === row);
    if (matches) verified += 1;
    else failures.push(`${slot.key}: expected ${slot.rows.join(',')}, found ${actual.slice(0, slot.rows.length).join(',')}`);
  }
  if (failures.length) throw new Error(`Depth chart verification failed: ${failures.join('; ')}`);
  return verified;
}

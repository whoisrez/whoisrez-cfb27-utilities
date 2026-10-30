// Reads and writes a team's depth chart in a CFB 27 dynasty save.
//
// Save layout (verified on a CFB 27 dynasty file):
//   Team.DepthChart  -> DepthChart record (one per team)
//   DepthChart.<KEY> -> Player[] array record (QB, HB, ..., LE, RE, ..., K, P, KR, PR, LS, ...)
//   Each array has a fixed capacity; the table's arraySizes[row] is the number of
//   spots the game uses (the count shown in the in-game depth chart).
// Only existing spots are rewritten. Arrays are never resized.

import Franchise from 'madden-franchise';
import type { DcInjury, DcPlayerView, DcTeamOption, DepthChartLoad, DepthChartWriteRequest } from '../../shared/depth-chart';
import { DISPLAY_POSITION } from '../../shared/depth-chart';
import { ALL_SLOT_KEYS, buildDepthChart } from './rules';

type ReferenceData = { tableId: number; rowNumber: number };
type FieldLike = { key?: string; value?: unknown; isReference?: boolean; referenceData?: { tableId?: number; rowNumber?: number } | null };
type RecordLike = Record<string, unknown> & { index?: number; isEmpty?: boolean; fields?: Record<string, FieldLike>; fieldsArray?: FieldLike[] };
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

export type DepthChartWriteResult = { writtenSlots: number; writtenEntries: number };

/** Short rating keys used by the rules → save-file field names. */
const RATING_FIELDS: Record<string, string> = {
  spd: 'SpeedRating', acc: 'AccelerationRating', agi: 'AgilityRating', cod: 'ChangeOfDirectionRating', str: 'StrengthRating',
  awr: 'AwarenessRating', tak: 'TackleRating', pow: 'HitPowerRating', pur: 'PursuitRating', prc: 'PlayRecognitionRating',
  bsh: 'BlockSheddingRating', pmv: 'PowerMovesRating', fmv: 'FinesseMovesRating', mcv: 'ManCoverageRating',
  zcv: 'ZoneCoverageRating', prs: 'PressRating', thp: 'ThrowPowerRating', tas: 'ThrowAccuracyShortRating',
  tam: 'ThrowAccuracyMidRating', tad: 'ThrowAccuracyDeepRating', tup: 'ThrowUnderPressureRating', car: 'CarryingRating',
  bcv: 'BCVisionRating', btk: 'BreakTackleRating', trk: 'TruckingRating', jkm: 'JukeMoveRating', cth: 'CatchingRating',
  cit: 'CatchInTrafficRating', rls: 'ReleaseRating', srr: 'ShortRouteRunningRating', mrr: 'MediumRouteRunningRating',
  drr: 'DeepRouteRunningRating', pbk: 'PassBlockRating', pbp: 'PassBlockPowerRating', pbf: 'PassBlockFinesseRating',
  rbk: 'RunBlockRating', lbk: 'LeadBlockRating', ibl: 'ImpactBlockingRating', kpw: 'KickPowerRating',
  kac: 'KickAccuracyRating', ret: 'KickReturnRating', ls: 'LongSnapRating',
};

function largestTable(franchise: FranchiseLike, name: string): TableLike {
  const tables = franchise.getAllTablesByName(name) ?? [];
  if (!tables.length) throw new Error(`No table found named "${name}".`);
  return tables.reduce((best, table) => (table.header.recordCapacity > best.header.recordCapacity ? table : best));
}

async function readTable(table: TableLike): Promise<TableLike> {
  if (!table.recordsRead) await table.readRecords();
  return table;
}

const num = (record: RecordLike, key: string, fallback = 0) => {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : fallback;
};
const str = (record: RecordLike, key: string) => String(record[key] ?? '').trim();
const rowOf = (record: RecordLike, fallback: number) => (Number.isFinite(Number(record.index)) ? Number(record.index) : fallback);

function decodeRef32(value: unknown): ReferenceData | null {
  const text = String(value ?? '');
  if (!/^[01]{32}$/.test(text)) return null;
  const tableId = Number.parseInt(text.slice(0, 15), 2);
  const rowNumber = Number.parseInt(text.slice(15), 2);
  return tableId ? { tableId, rowNumber } : null;
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

const teamName = (record: RecordLike) => str(record, 'DisplayName') || str(record, 'LongName') || str(record, 'ShortName');
const isUserTeam = (record: RecordLike) => Boolean(fieldRef(record.fields?.UserCharacter));

type Context = { franchise: FranchiseLike; teamTable: TableLike; playerTable: TableLike; playerTableId: number };

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
    const name = teamName(record);
    const teamIndex = num(record, 'TeamIndex', -1);
    if (!name || teamIndex < 0 || /^practice$/i.test(name)) continue;
    options.push({ teamIndex, teamName: name, isUserControlled: isUserTeam(record) });
  }
  return options.sort((a, b) => Number(b.isUserControlled) - Number(a.isUserControlled) || a.teamName.localeCompare(b.teamName));
}

function findTeam(teamTable: TableLike, teamIndex: number): RecordLike {
  const record = teamTable.records.find((item) => item && !item.isEmpty && num(item, 'TeamIndex', -1) === teamIndex);
  if (!record) throw new Error(`Team ${teamIndex} was not found in the save.`);
  return record;
}

type SlotArray = { record: RecordLike; size: number; rows: number[] };

async function readDepthChartArrays(ctx: Context, team: RecordLike): Promise<Map<string, SlotArray>> {
  const chartRef = fieldRef(team.fields?.DepthChart);
  if (!chartRef) throw new Error(`${teamName(team)} has no depth chart in this save.`);
  const chart = (await readTable(ctx.franchise.getTableById(chartRef.tableId))).records[chartRef.rowNumber];
  if (!chart || chart.isEmpty) throw new Error('The team depth chart record is empty.');

  const arrays = new Map<string, SlotArray>();
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
    arrays.set(key, { record, size, rows: rows.slice(0, size) });
  }
  return arrays;
}

function readInjury(record: RecordLike): DcInjury | null {
  const status = str(record, 'InjuryStatus');
  const reserve = /^true$/i.test(str(record, 'IsInjuredReserve'));
  if ((!status || /^uninjured$/i.test(status)) && !reserve) return null;
  const weeks = Math.max(0, num(record, 'MaxInjuryDuration'), num(record, 'MinInjuryDuration'), num(record, 'TotalInjuryDuration'));
  return { status, type: str(record, 'InjuryType'), weeks, reserve };
}

function toPlayer(record: RecordLike, row: number): DcPlayerView {
  const position = str(record, 'Position');
  const ratings: Record<string, number> = {};
  for (const [key, field] of Object.entries(RATING_FIELDS)) ratings[key] = num(record, field);
  return {
    row,
    name: `${str(record, 'FirstName')} ${str(record, 'LastName')}`.trim(),
    position,
    displayPosition: DISPLAY_POSITION[position] ?? position,
    jersey: num(record, 'JerseyNum'),
    ovr: num(record, 'OverallRating'),
    archetype: str(record, 'PlayerType'),
    year: str(record, 'SchoolYear'),
    dev: str(record, 'TraitDevelopment'),
    weight: num(record, 'Weight') + 160,
    ratings,
    injury: readInjury(record),
  };
}

function teamRoster(ctx: Context, teamIndex: number): DcPlayerView[] {
  const players: DcPlayerView[] = [];
  ctx.playerTable.records.forEach((record, fallback) => {
    if (!record || record.isEmpty || num(record, 'TeamIndex', -1) !== teamIndex || !str(record, 'LastName')) return;
    players.push(toPlayer(record, rowOf(record, fallback)));
  });
  return players;
}

export async function loadDepthChart(filePath: string, requestedTeamIndex?: number | null): Promise<DepthChartLoad> {
  const ctx = await open(filePath);
  const teams = teamOptions(ctx.teamTable);
  if (!teams.length) throw new Error('No teams were found in this save.');
  const teamIndex = requestedTeamIndex != null && teams.some((team) => team.teamIndex === requestedTeamIndex)
    ? requestedTeamIndex
    : (teams.find((team) => team.isUserControlled) ?? teams[0]).teamIndex;
  const team = findTeam(ctx.teamTable, teamIndex);
  const players = teamRoster(ctx, teamIndex);
  if (!players.length) throw new Error(`No players were found for ${teamName(team)}.`);

  const arrays = await readDepthChartArrays(ctx, team);
  const sizes: Record<string, number> = {};
  const current: Record<string, number[]> = {};
  for (const [key, slot] of arrays) {
    sizes[key] = slot.size;
    current[key] = slot.rows;
  }
  return { filePath, teams, teamIndex, teamName: teamName(team), players, plan: buildDepthChart({ players, sizes, current }) };
}

function validateRequest(request: DepthChartWriteRequest, arrays: Map<string, SlotArray>, teamPlayers: Set<number>): void {
  if (!request.slots.length) throw new Error('No depth chart spots were provided.');
  for (const slot of request.slots) {
    const target = arrays.get(slot.key);
    if (!ALL_SLOT_KEYS.includes(slot.key) || !target) throw new Error(`${slot.key} was not found in this team's depth chart.`);
    if (slot.rows.length > target.size) throw new Error(`${slot.key} has ${target.size} spots but ${slot.rows.length} players were provided.`);
    if (new Set(slot.rows).size !== slot.rows.length) throw new Error(`${slot.key} lists the same player twice.`);
    for (const row of slot.rows) if (!teamPlayers.has(row)) throw new Error(`${slot.key}: player row ${row} is not on this team.`);
  }
}

export async function writeDepthChart(inputPath: string, outputPath: string, request: DepthChartWriteRequest): Promise<DepthChartWriteResult> {
  const ctx = await open(inputPath);
  const arrays = await readDepthChartArrays(ctx, findTeam(ctx.teamTable, request.teamIndex));
  validateRequest(request, arrays, new Set(teamRoster(ctx, request.teamIndex).map((player) => player.row)));

  let writtenEntries = 0;
  for (const slot of request.slots) {
    const target = arrays.get(slot.key)!;
    const fields = target.record.fieldsArray ?? [];
    slot.rows.forEach((row, index) => {
      const field = fields[index];
      if (!field) throw new Error(`${slot.key}: spot ${index + 1} does not exist.`);
      const encoded = encodeRef32(ctx.playerTableId, row);
      field.value = encoded;
      if (field.key) target.record[field.key] = encoded;
      writtenEntries += 1;
    });
  }
  await ctx.franchise.save(outputPath);
  return { writtenSlots: request.slots.length, writtenEntries };
}

/** Re-open a written save and confirm every requested spot reads back exactly. */
export async function verifyDepthChart(filePath: string, request: DepthChartWriteRequest): Promise<number> {
  const ctx = await open(filePath);
  const arrays = await readDepthChartArrays(ctx, findTeam(ctx.teamTable, request.teamIndex));
  const failures: string[] = [];
  for (const slot of request.slots) {
    const actual = arrays.get(slot.key)?.rows ?? [];
    if (!slot.rows.every((row, index) => actual[index] === row)) {
      failures.push(`${slot.key}: expected ${slot.rows.join(',')}, found ${actual.slice(0, slot.rows.length).join(',')}`);
    }
  }
  if (failures.length) throw new Error(`Depth chart verification failed: ${failures.join('; ')}`);
  return request.slots.length;
}

import Franchise from 'madden-franchise';
import { loadDynastySnapshot } from './dynasty-reader';
import type { Movement } from './types';

type ReferenceData = { tableId: number; rowNumber: number };
type ReferenceField = {
  key?: string;
  value?: unknown;
  isReference?: boolean;
  referenceData?: { tableId?: number; rowNumber?: number } | null;
};
type RecordLike = Record<string, unknown> & {
  index?: number;
  isEmpty?: boolean;
  fields?: Record<string, ReferenceField>;
  fieldsArray?: ReferenceField[];
};
type TableLike = {
  name?: string;
  header: { tableId?: number; recordCapacity: number };
  records: RecordLike[];
  recordsRead?: boolean;
  readRecords: (attributes?: string[]) => Promise<void>;
};
type FranchiseLike = {
  getAllTablesByName: (name: string) => TableLike[];
  getTableById: (id: number) => TableLike;
  save: (output?: string) => Promise<void>;
};

type ConferenceSlots = {
  name: string;
  record: RecordLike;
};

type SlotMatch = {
  key: string;
  field: ReferenceField | null;
};

export type ConferenceWriteResult = {
  appliedMovements: number;
  skippedIndependent: number;
};

function canonicalConference(value: string): string {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases: Record<string, string> = {
    acc: 'ACC', american: 'American', aac: 'American', bigten: 'Big Ten', b10: 'Big Ten',
    mac: 'MAC', big12: 'Big 12', b12: 'Big 12', cusa: 'C-USA', conferenceusa: 'C-USA',
    mountainwest: 'Mountain West', mw: 'Mountain West', pac12: 'Pac-12', pac: 'Pac-12',
    sec: 'SEC', sunbelt: 'Sun Belt', sbc: 'Sun Belt', independent: 'Independent', independents: 'Independent',
  };
  return aliases[key] ?? value.trim();
}

function largestTable(franchise: FranchiseLike, name: string): TableLike {
  const tables = franchise.getAllTablesByName(name) ?? [];
  if (!tables.length) throw new Error(`No table found named "${name}".`);
  return tables.reduce((best, table) => table.header.recordCapacity > best.header.recordCapacity ? table : best);
}

function nonEmpty(records: RecordLike[]): RecordLike[] {
  return records.filter((record) => record && !record.isEmpty);
}

function str(record: RecordLike | null | undefined, key: string): string {
  return String(record?.[key] ?? '').trim();
}

function num(record: RecordLike | null | undefined, key: string, fallback = 0): number {
  const value = Number(record?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function ref(record: RecordLike | null | undefined, key: string): ReferenceData | null {
  const field = record?.fields?.[key];
  if (field?.isReference) {
    const tableId = Number(field.referenceData?.tableId ?? 0);
    const rowNumber = Number(field.referenceData?.rowNumber ?? -1);
    if (Number.isFinite(tableId) && tableId > 0 && Number.isFinite(rowNumber) && rowNumber >= 0) {
      return { tableId, rowNumber };
    }
  }

  const raw = String(record?.[key] ?? '');
  return decodeRef32(raw);
}

function decodeRef32(value: string): ReferenceData | null {
  if (!/^[01]{32}$/.test(value)) return null;
  const tableId = Number.parseInt(value.slice(0, 15), 2);
  const rowNumber = Number.parseInt(value.slice(15), 2);
  if (!tableId || rowNumber < 0) return null;
  return { tableId, rowNumber };
}

function encodeRef32(tableId: number, rowNumber: number): string {
  if (!Number.isInteger(tableId) || tableId <= 0 || tableId >= 2 ** 15) {
    throw new Error(`Invalid reference table ID ${tableId}.`);
  }
  if (!Number.isInteger(rowNumber) || rowNumber < 0 || rowNumber >= 2 ** 17) {
    throw new Error(`Invalid reference row ${rowNumber}.`);
  }
  return `${tableId.toString(2).padStart(15, '0')}${rowNumber.toString(2).padStart(17, '0')}`;
}

async function readTable(table: TableLike): Promise<TableLike> {
  if (!table.recordsRead) await table.readRecords();
  return table;
}

function pairedMovements(movements: Movement[]): Movement[] {
  return movements.filter((movement) =>
    movement.pairKey !== 'independent' &&
    (movement.kind === 'promotion' || movement.kind === 'relegation'));
}

function fieldCandidates(record: RecordLike): Array<{ key: string; field: ReferenceField | null }> {
  const result: Array<{ key: string; field: ReferenceField | null }> = [];
  const seen = new Set<string>();

  for (const field of record.fieldsArray ?? []) {
    const key = String(field.key ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ key, field });
  }

  for (const [key, field] of Object.entries(record.fields ?? {})) {
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ key, field });
  }

  return result;
}

function findTeamSlot(record: RecordLike, teamTableId: number, teamRow: number): SlotMatch {
  const matches: SlotMatch[] = [];
  for (const candidate of fieldCandidates(record)) {
    const metadataTableId = Number(candidate.field?.referenceData?.tableId ?? 0);
    const metadataRow = Number(candidate.field?.referenceData?.rowNumber ?? -1);
    if (candidate.field?.isReference && metadataTableId === teamTableId && metadataRow === teamRow) {
      matches.push(candidate);
      continue;
    }

    const raw = String(record[candidate.key] ?? candidate.field?.value ?? '');
    const decoded = decodeRef32(raw);
    if (decoded?.tableId === teamTableId && decoded.rowNumber === teamRow) matches.push(candidate);
  }

  if (matches.length !== 1) {
    throw new Error(`Expected exactly one conference slot for Team row ${teamRow}, found ${matches.length}.`);
  }
  return matches[0];
}

function writeTeamSlot(record: RecordLike, match: SlotMatch, teamTableId: number, teamRow: number): void {
  const encoded = encodeRef32(teamTableId, teamRow);
  if (match.field) {
    match.field.value = encoded;
  }
  record[match.key] = encoded;
}

async function loadWriteContext(filePath: string): Promise<{
  franchise: FranchiseLike;
  teamTableId: number;
  teamRowByIndex: Map<number, number>;
  conferenceSlots: Map<string, ConferenceSlots>;
}> {
  const opened = await Franchise.create(filePath);
  const franchise = opened as unknown as FranchiseLike;
  const teamTable = largestTable(franchise, 'Team');
  const conferenceTable = largestTable(franchise, 'Conference');
  await Promise.all([readTable(teamTable), readTable(conferenceTable)]);

  const teamTableId = Number(teamTable.header.tableId ?? 0);
  if (!teamTableId) throw new Error('Team table ID was not available.');

  const teamRowByIndex = new Map<number, number>();
  teamTable.records.forEach((record, fallbackRow) => {
    if (!record || record.isEmpty) return;
    const row = Number.isFinite(Number(record.index)) ? Number(record.index) : fallbackRow;
    teamRowByIndex.set(num(record, 'TeamIndex', row), row);
  });

  const conferenceSlots = new Map<string, ConferenceSlots>();
  for (const conferenceRecord of nonEmpty(conferenceTable.records)) {
    const rawName = str(conferenceRecord, 'Name') || str(conferenceRecord, 'ConferenceEnum');
    if (!rawName) continue;
    const slotsReference = ref(conferenceRecord, 'TeamSlots');
    if (!slotsReference) continue;
    const slotsTable = await readTable(franchise.getTableById(slotsReference.tableId));
    const slotsRecord = slotsTable.records[slotsReference.rowNumber];
    if (!slotsRecord || slotsRecord.isEmpty) continue;
    const name = canonicalConference(rawName);
    conferenceSlots.set(name, { name, record: slotsRecord });
  }

  return { franchise, teamTableId, teamRowByIndex, conferenceSlots };
}

function validatePairShape(pairKey: string, movements: Movement[]): [Movement, Movement] {
  if (movements.length !== 2) {
    throw new Error(`${pairKey}: automatic save writing requires exactly one promotion and one relegation.`);
  }
  const promotion = movements.find((movement) => movement.kind === 'promotion');
  const relegation = movements.find((movement) => movement.kind === 'relegation');
  if (!promotion || !relegation) throw new Error(`${pairKey}: promotion/relegation pair is incomplete.`);
  if (promotion.fromConference !== relegation.toConference || promotion.toConference !== relegation.fromConference) {
    throw new Error(`${pairKey}: movements are not a reciprocal conference swap.`);
  }
  return [promotion, relegation];
}

export async function writeConferenceMovements(inputPath: string, outputPath: string, movements: Movement[]): Promise<ConferenceWriteResult> {
  const paired = pairedMovements(movements);
  if (!paired.length) throw new Error('There are no paired promotion/relegation movements to apply.');

  const { franchise, teamTableId, teamRowByIndex, conferenceSlots } = await loadWriteContext(inputPath);
  const byPair = new Map<string, Movement[]>();
  for (const movement of paired) {
    const list = byPair.get(movement.pairKey) ?? [];
    list.push(movement);
    byPair.set(movement.pairKey, list);
  }

  for (const [pairKey, group] of byPair.entries()) {
    const [promotion, relegation] = validatePairShape(pairKey, group);
    const promotionRow = teamRowByIndex.get(promotion.teamIndex);
    const relegationRow = teamRowByIndex.get(relegation.teamIndex);
    if (promotionRow == null) throw new Error(`${promotion.teamName}: Team row was not found.`);
    if (relegationRow == null) throw new Error(`${relegation.teamName}: Team row was not found.`);

    const lowerSlots = conferenceSlots.get(canonicalConference(promotion.fromConference));
    const upperSlots = conferenceSlots.get(canonicalConference(promotion.toConference));
    if (!lowerSlots) throw new Error(`Conference slots were not found for ${promotion.fromConference}.`);
    if (!upperSlots) throw new Error(`Conference slots were not found for ${promotion.toConference}.`);

    const promotionSlot = findTeamSlot(lowerSlots.record, teamTableId, promotionRow);
    const relegationSlot = findTeamSlot(upperSlots.record, teamTableId, relegationRow);

    // Each paired movement is an exact slot swap. Write the binary Team references
    // directly through the Franchise field API so both the formatted and raw values
    // are marked changed before save().
    writeTeamSlot(lowerSlots.record, promotionSlot, teamTableId, relegationRow);
    writeTeamSlot(upperSlots.record, relegationSlot, teamTableId, promotionRow);
  }

  await franchise.save(outputPath);
  return {
    appliedMovements: paired.length,
    skippedIndependent: movements.length - paired.length,
  };
}

export async function validateConferenceMovements(filePath: string, movements: Movement[]): Promise<number> {
  const paired = pairedMovements(movements);
  const snapshot = await loadDynastySnapshot(filePath);
  const failures: string[] = [];
  for (const movement of paired) {
    const team = snapshot.teams.find((item) => item.teamIndex === movement.teamIndex);
    const actual = canonicalConference(team?.conference ?? '');
    const expected = canonicalConference(movement.toConference);
    if (!team || actual !== expected) {
      failures.push(`${movement.teamName}: expected ${movement.toConference}, found ${team?.conference ?? 'not found'}`);
    }
  }
  if (failures.length) throw new Error(`Conference verification failed: ${failures.join('; ')}`);
  return paired.length;
}

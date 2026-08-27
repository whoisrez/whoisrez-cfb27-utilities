import { writeFile } from 'node:fs/promises';
import Franchise from 'madden-franchise';

type FieldMeta = {
  key?: string;
  isReference?: boolean;
  referenceData?: { tableId?: number; rowNumber?: number } | null;
};

type RecordLike = Record<string, unknown> & {
  index?: number;
  isEmpty?: boolean;
  fields?: Record<string, FieldMeta>;
  fieldsArray?: FieldMeta[];
};

type TableLike = {
  index?: number;
  name?: string;
  data?: Buffer;
  records: RecordLike[];
  recordsRead?: boolean;
  readRecords: () => Promise<void>;
  header: { tableId?: number; uniqueId?: number; recordCapacity?: number };
};

type FranchiseLike = { tables: TableLike[] };

type FieldChange = {
  row: number;
  field: string;
  before: unknown;
  after: unknown;
};

type TableChange = {
  tableIndex: number;
  tableId: number | null;
  uniqueId: number | null;
  name: string;
  rawChanged: boolean;
  fieldChanges: FieldChange[];
  readError?: string;
};

function tableKey(table: TableLike): string {
  const uniqueId = Number(table.header?.uniqueId ?? 0);
  if (uniqueId) return `u:${uniqueId}`;
  const tableId = Number(table.header?.tableId ?? 0);
  if (tableId) return `t:${tableId}`;
  return `i:${Number(table.index ?? -1)}:${table.name ?? ''}`;
}

function fieldNames(record: RecordLike | undefined): string[] {
  if (!record) return [];
  const names = new Set<string>();
  for (const key of Object.keys(record.fields ?? {})) names.add(key);
  for (const field of record.fieldsArray ?? []) {
    if (field.key) names.add(String(field.key));
  }
  return [...names].sort();
}

function normalizePrimitive(value: unknown): unknown {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return `<Buffer ${value.length} bytes>`;
  try { return JSON.parse(JSON.stringify(value)); } catch { return String(value); }
}

function fieldValue(record: RecordLike | undefined, key: string): unknown {
  if (!record) return null;
  const field = record.fields?.[key] ?? record.fieldsArray?.find((item) => item.key === key);
  const value = normalizePrimitive(record[key]);
  if (!field?.isReference) return value;
  return {
    value,
    reference: {
      tableId: Number(field.referenceData?.tableId ?? 0),
      rowNumber: Number(field.referenceData?.rowNumber ?? -1),
    },
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function ensureRead(table: TableLike): Promise<void> {
  if (!table.recordsRead) await table.readRecords();
}

function rawEqual(a: TableLike, b: TableLike): boolean {
  if (!Buffer.isBuffer(a.data) || !Buffer.isBuffer(b.data)) return false;
  return a.data.equals(b.data);
}

export async function compareConferenceSaves(beforePath: string, afterPath: string, outputPath: string): Promise<{ outputPath: string; changedTables: number; changedFields: number }> {
  const [beforeOpened, afterOpened] = await Promise.all([Franchise.create(beforePath), Franchise.create(afterPath)]);
  const before = beforeOpened as unknown as FranchiseLike;
  const after = afterOpened as unknown as FranchiseLike;

  const afterMap = new Map(after.tables.map((table) => [tableKey(table), table]));
  const changes: TableChange[] = [];
  let changedFields = 0;

  for (const beforeTable of before.tables) {
    const afterTable = afterMap.get(tableKey(beforeTable));
    if (!afterTable) continue;
    if (rawEqual(beforeTable, afterTable)) continue;

    const tableChange: TableChange = {
      tableIndex: Number(beforeTable.index ?? -1),
      tableId: Number.isFinite(Number(beforeTable.header?.tableId)) ? Number(beforeTable.header.tableId) : null,
      uniqueId: Number.isFinite(Number(beforeTable.header?.uniqueId)) ? Number(beforeTable.header.uniqueId) : null,
      name: String(beforeTable.name ?? ''),
      rawChanged: true,
      fieldChanges: [],
    };

    try {
      await Promise.all([ensureRead(beforeTable), ensureRead(afterTable)]);
      const rowCount = Math.max(beforeTable.records.length, afterTable.records.length);
      for (let row = 0; row < rowCount; row += 1) {
        const beforeRecord = beforeTable.records[row];
        const afterRecord = afterTable.records[row];
        if (Boolean(beforeRecord?.isEmpty) !== Boolean(afterRecord?.isEmpty)) {
          tableChange.fieldChanges.push({ row, field: '$isEmpty', before: Boolean(beforeRecord?.isEmpty), after: Boolean(afterRecord?.isEmpty) });
          changedFields += 1;
        }
        const names = new Set([...fieldNames(beforeRecord), ...fieldNames(afterRecord)]);
        for (const key of names) {
          const beforeValue = fieldValue(beforeRecord, key);
          const afterValue = fieldValue(afterRecord, key);
          if (sameValue(beforeValue, afterValue)) continue;
          tableChange.fieldChanges.push({ row, field: key, before: beforeValue, after: afterValue });
          changedFields += 1;
        }
      }
    } catch (error) {
      tableChange.readError = error instanceof Error ? error.message : String(error);
    }

    changes.push(tableChange);
  }

  changes.sort((a, b) => b.fieldChanges.length - a.fieldChanges.length || a.name.localeCompare(b.name));
  const likely = changes.filter((table) => /conf|team|league|division|slot|member|realign/i.test(`${table.name} ${table.fieldChanges.map((item) => item.field).join(' ')}`));
  const report = {
    generatedAt: new Date().toISOString(),
    beforePath,
    afterPath,
    summary: {
      changedTables: changes.length,
      changedFields,
      likelyConferenceTables: likely.length,
    },
    likelyConferenceChanges: likely,
    allChanges: changes,
  };
  await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
  return { outputPath, changedTables: changes.length, changedFields };
}

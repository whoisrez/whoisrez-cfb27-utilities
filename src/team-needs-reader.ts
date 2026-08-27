import path from 'node:path';
import Franchise from 'madden-franchise';

export type TeamNeedsPlayer = {
  position: string;
  schoolYear: string;
  redshirtStatus: string;
};

export type TeamNeedsRecruit = {
  position: string;
  recruitStage: string;
};

export type TeamNeedsTeam = {
  teamName: string;
  teamIndex: number;
  isUserControlled: boolean;
  roster: TeamNeedsPlayer[];
  recruits: TeamNeedsRecruit[];
  recruitingAuto: boolean;
};

export type TeamNeedsDynasty = {
  filePath: string;
  teams: TeamNeedsTeam[];
};

type FranchiseReferenceFieldLike = {
  key?: string;
  isReference?: boolean;
  referenceData?: {
    tableId?: number;
    rowNumber?: number;
  } | null;
};

type FranchiseRecordLike = Record<string, unknown> & {
  isEmpty?: boolean;
  fields?: Record<string, FranchiseReferenceFieldLike>;
  fieldsArray?: FranchiseReferenceFieldLike[];
};

type FranchiseTableLike = {
  header: { recordCapacity: number; tableId?: number };
  records: FranchiseRecordLike[];
  readRecords: (attributes?: string[]) => Promise<void>;
};

type FranchiseLike = {
  getAllTablesByName: (name: string) => FranchiseTableLike[];
  getTableById: (id: number) => FranchiseTableLike;
};

type ReferenceData = {
  tableId: number;
  rowNumber: number;
};

function largestTable(franchise: FranchiseLike, name: string): FranchiseTableLike {
  const tables = franchise.getAllTablesByName(name);
  if (!tables || tables.length === 0) throw new Error(`No table found named "${name}".`);
  return tables.reduce((largest, table) => table.header.recordCapacity > largest.header.recordCapacity ? table : largest);
}

function optionalLargestTable(franchise: FranchiseLike, name: string): FranchiseTableLike | null {
  const tables = franchise.getAllTablesByName(name) ?? [];
  if (tables.length === 0) return null;
  return tables.reduce((largest, table) => table.header.recordCapacity > largest.header.recordCapacity ? table : largest);
}

function nonEmpty(records: FranchiseRecordLike[]): FranchiseRecordLike[] {
  return records.filter((record) => !record.isEmpty);
}

function teamName(record: FranchiseRecordLike): string {
  return String(record.DisplayName ?? record.LongName ?? record.ShortName ?? '').trim();
}

function truthy(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function appearsUserControlled(record: FranchiseRecordLike): boolean {
  const exactCandidates = new Set([
    'isusercontrolled',
    'usercontrolled',
    'isuserteam',
    'userteam',
    'ishumancontrolled',
    'humancontrolled',
  ]);

  return Object.entries(record).some(([key, value]) => {
    if (!truthy(value)) return false;
    const normalized = normalizeKey(key);
    if (exactCandidates.has(normalized)) return true;
    const mentionsUser = normalized.includes('user') || normalized.includes('human');
    const mentionsControl = normalized.includes('control') || normalized.includes('team');
    return mentionsUser && mentionsControl;
  });
}

function hasUserCharacterReference(record: FranchiseRecordLike): boolean {
  const field = record.fields?.UserCharacter;
  if (!field?.isReference) return false;
  const tableId = Number(field.referenceData?.tableId ?? 0);
  return Number.isFinite(tableId) && tableId !== 0;
}

function recordTeamIndex(record: FranchiseRecordLike): number | null {
  const direct = Number(record.TeamIndex);
  if (Number.isFinite(direct)) return direct;
  for (const [key, value] of Object.entries(record)) {
    const normalized = normalizeKey(key);
    if (normalized !== 'teamindex' && normalized !== 'teamid') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function referenceData(record: FranchiseRecordLike, key: string): ReferenceData | null {
  const field = record.fields?.[key];
  if (!field?.isReference) return null;
  const tableId = Number(field.referenceData?.tableId ?? 0);
  const rowNumber = Number(field.referenceData?.rowNumber ?? -1);
  if (!Number.isFinite(tableId) || tableId === 0 || !Number.isFinite(rowNumber) || rowNumber < 0) return null;
  return { tableId, rowNumber };
}

function referenceKey(ref: ReferenceData): string {
  return `${ref.tableId}:${ref.rowNumber}`;
}

function recordReferenceFields(record: FranchiseRecordLike): FranchiseReferenceFieldLike[] {
  return record.fieldsArray ?? Object.values(record.fields ?? {});
}

function validReference(field: FranchiseReferenceFieldLike): ReferenceData | null {
  if (!field?.isReference) return null;
  const tableId = Number(field.referenceData?.tableId ?? 0);
  const rowNumber = Number(field.referenceData?.rowNumber ?? -1);
  if (!Number.isFinite(tableId) || tableId === 0 || !Number.isFinite(rowNumber) || rowNumber < 0) return null;
  return { tableId, rowNumber };
}

async function ensureRead(table: FranchiseTableLike, readTables: Set<FranchiseTableLike>): Promise<void> {
  if (readTables.has(table)) return;
  await table.readRecords();
  readTables.add(table);
}

async function referencedRecord(
  franchise: FranchiseLike,
  ref: ReferenceData | null,
  readTables: Set<FranchiseTableLike>,
): Promise<FranchiseRecordLike | null> {
  if (!ref) return null;
  try {
    const table = franchise.getTableById(ref.tableId);
    if (!table) return null;
    await ensureRead(table, readTables);
    const record = table.records[ref.rowNumber];
    return record && !record.isEmpty ? record : null;
  } catch {
    return null;
  }
}

function isCommittedRecruitStage(value: unknown): boolean {
  const stage = normalizeKey(String(value ?? ''));
  return stage === 'softcommitted' || stage === 'hardcommitted' || stage === 'signed';
}

async function recruitCommittedToTeam(
  franchise: FranchiseLike,
  recruit: FranchiseRecordLike,
  teamIndex: number,
  readTables: Set<FranchiseTableLike>,
): Promise<boolean> {
  const topSchools = await referencedRecord(franchise, referenceData(recruit, 'TopSchoolsList'), readTables);
  if (!topSchools) return false;
  const firstSchoolRef = recordReferenceFields(topSchools)
    .map(validReference)
    .find((ref): ref is ReferenceData => ref != null);
  const firstSchool = await referencedRecord(franchise, firstSchoolRef ?? null, readTables);
  return Boolean(firstSchool && Number(firstSchool.TeamId) === teamIndex);
}

async function recruitFromTarget(
  franchise: FranchiseLike,
  target: FranchiseRecordLike,
  readTables: Set<FranchiseTableLike>,
): Promise<{ recruit: FranchiseRecordLike; playerRef: ReferenceData } | null> {
  const recruit = await referencedRecord(franchise, referenceData(target, 'Recruit'), readTables);
  if (!recruit) return null;
  const playerRef = referenceData(recruit, 'Player');
  if (!playerRef) return null;
  return { recruit, playerRef };
}

async function readCommittedRecruitsFromBoard(
  franchise: FranchiseLike,
  teamIndex: number,
  readTables: Set<FranchiseTableLike>,
): Promise<{ recruits: TeamNeedsRecruit[]; recruitingAuto: boolean } | null> {
  const boardTable = optionalLargestTable(franchise, 'RecruitTarget[]');
  if (!boardTable) return null;

  await ensureRead(boardTable, readTables);
  const board = boardTable.records[teamIndex];
  if (!board || board.isEmpty) return null;

  const targetRefs = recordReferenceFields(board)
    .map(validReference)
    .filter((ref): ref is ReferenceData => ref != null);
  if (targetRefs.length === 0) return null;

  const recruits: TeamNeedsRecruit[] = [];
  const seenPlayers = new Set<string>();

  for (const targetRef of targetRefs) {
    const target = await referencedRecord(franchise, targetRef, readTables);
    if (!target) continue;

    const resolved = await recruitFromTarget(franchise, target, readTables);
    if (!resolved) continue;
    const { recruit, playerRef } = resolved;

    if (!isCommittedRecruitStage(recruit.RecruitStage)) continue;
    if (!(await recruitCommittedToTeam(franchise, recruit, teamIndex, readTables))) continue;

    const playerKey = referenceKey(playerRef);
    if (seenPlayers.has(playerKey)) continue;
    const player = await referencedRecord(franchise, playerRef, readTables);
    const position = String(player?.Position ?? '').trim();
    if (!position) continue;

    seenPlayers.add(playerKey);
    recruits.push({
      position,
      recruitStage: String(recruit.RecruitStage ?? '').trim(),
    });
  }

  return { recruits, recruitingAuto: true };
}

async function readCommittedRecruitsForTeam(
  franchise: FranchiseLike,
  teamIndex: number,
  readTables: Set<FranchiseTableLike>,
): Promise<{ recruits: TeamNeedsRecruit[]; recruitingAuto: boolean }> {
  try {
    // The game's RecruitTarget[] row is the actual 35-player board for this school.
    // The user's target refs can point to a different RecruitTarget table, so resolve
    // each slot by its own tableId instead of assuming the normal CPU target table.
    const boardResult = await readCommittedRecruitsFromBoard(franchise, teamIndex, readTables);
    if (boardResult) return boardResult;

    // Fallback for unusual/older saves that do not expose a readable board row.
    const recruitTable = optionalLargestTable(franchise, 'Recruit');
    if (!recruitTable) return { recruits: [], recruitingAuto: false };
    await ensureRead(recruitTable, readTables);
    const recruits: TeamNeedsRecruit[] = [];
    const seenPlayers = new Set<string>();
    for (const recruit of nonEmpty(recruitTable.records)) {
      if (!isCommittedRecruitStage(recruit.RecruitStage)) continue;
      if (!(await recruitCommittedToTeam(franchise, recruit, teamIndex, readTables))) continue;
      const playerRef = referenceData(recruit, 'Player');
      if (!playerRef) continue;
      const playerKey = referenceKey(playerRef);
      if (seenPlayers.has(playerKey)) continue;
      const player = await referencedRecord(franchise, playerRef, readTables);
      const position = String(player?.Position ?? '').trim();
      if (!position) continue;
      seenPlayers.add(playerKey);
      recruits.push({ position, recruitStage: String(recruit.RecruitStage ?? '').trim() });
    }
    return { recruits, recruitingAuto: true };
  } catch {
    return { recruits: [], recruitingAuto: false };
  }
}

async function userControlledTeamIndices(franchise: FranchiseLike): Promise<Set<number>> {
  const userTeams = new Set<number>();
  const coachTables = franchise.getAllTablesByName('Coach') ?? [];
  for (const table of coachTables) {
    try {
      await table.readRecords();
      for (const record of nonEmpty(table.records)) {
        if (!appearsUserControlled(record)) continue;
        const teamIndex = recordTeamIndex(record);
        if (teamIndex != null) userTeams.add(teamIndex);
      }
    } catch {
      // Team.UserCharacter remains the primary signal.
    }
  }
  return userTeams;
}

function saveNameMatchesTeam(filePath: string, name: string): boolean {
  const saveName = normalizeKey(path.basename(filePath, path.extname(filePath)));
  const normalizedTeamName = normalizeKey(name);
  return normalizedTeamName.length >= 3 && saveName.includes(normalizedTeamName);
}

export async function loadTeamNeedsDynasty(filePath: string): Promise<TeamNeedsDynasty> {
  const opened = await Franchise.create(filePath);
  const franchise = opened as unknown as FranchiseLike;

  const teamTable = largestTable(franchise, 'Team');
  const playerTable = largestTable(franchise, 'Player');
  await teamTable.readRecords();
  await playerTable.readRecords();
  const readTables = new Set<FranchiseTableLike>([teamTable, playerTable]);

  const teamRecords = nonEmpty(teamTable.records);
  const userCharacterTeams = new Set<number>();
  for (const record of teamRecords) {
    const index = recordTeamIndex(record);
    if (index != null && hasUserCharacterReference(record)) userCharacterTeams.add(index);
  }

  const coachUserTeams = userCharacterTeams.size === 0
    ? await userControlledTeamIndices(franchise)
    : new Set<number>();

  const playersByTeam = new Map<number, TeamNeedsPlayer[]>();
  for (const record of nonEmpty(playerTable.records)) {
    const index = Number(record.TeamIndex);
    if (!Number.isFinite(index) || !String(record.LastName ?? '').trim()) continue;
    const player: TeamNeedsPlayer = {
      position: String(record.Position ?? '').trim(),
      schoolYear: String(record.SchoolYear ?? '').trim(),
      redshirtStatus: String(record.RedshirtStatus ?? '').trim(),
    };
    const roster = playersByTeam.get(index) ?? [];
    roster.push(player);
    playersByTeam.set(index, roster);
  }

  const detectedUserTeams = userCharacterTeams.size > 0 ? userCharacterTeams : coachUserTeams;
  const recruitingByTeam = new Map<number, { recruits: TeamNeedsRecruit[]; recruitingAuto: boolean }>();
  for (const index of detectedUserTeams) {
    recruitingByTeam.set(index, await readCommittedRecruitsForTeam(franchise, index, readTables));
  }

  const teams: TeamNeedsTeam[] = [];
  for (const record of teamRecords) {
    const index = Number(record.TeamIndex);
    const name = teamName(record);
    const roster = playersByTeam.get(index) ?? [];
    if (!Number.isFinite(index) || !name || roster.length === 0) continue;

    const isUserControlled = userCharacterTeams.size > 0
      ? userCharacterTeams.has(index)
      : appearsUserControlled(record)
        || coachUserTeams.has(index)
        || saveNameMatchesTeam(filePath, name);

    let recruiting = recruitingByTeam.get(index);
    if (!recruiting && isUserControlled) {
      recruiting = await readCommittedRecruitsForTeam(franchise, index, readTables);
      recruitingByTeam.set(index, recruiting);
    }

    teams.push({
      teamName: name,
      teamIndex: index,
      isUserControlled,
      roster,
      recruits: recruiting?.recruits ?? [],
      recruitingAuto: recruiting?.recruitingAuto ?? false,
    });
  }

  teams.sort((a, b) => Number(b.isUserControlled) - Number(a.isUserControlled) || a.teamName.localeCompare(b.teamName));
  if (teams.length === 0) throw new Error('The save opened, but no team rosters could be read.');
  return { filePath, teams };
}

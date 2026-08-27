import path from 'node:path';
import crypto from 'node:crypto';
import Franchise from 'madden-franchise';
import type { ConferenceChampion, DynastySnapshot, GameResult, TeamRef, TeamSeason } from './types';

type ReferenceData = { tableId: number; rowNumber: number };
type ReferenceField = { isReference?: boolean; referenceData?: { tableId?: number; rowNumber?: number } | null };
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
};

function largestTable(franchise: FranchiseLike, name: string): TableLike {
  const tables = franchise.getAllTablesByName(name) ?? [];
  if (!tables.length) throw new Error(`No table found named "${name}".`);
  return tables.reduce((best, table) => table.header.recordCapacity > best.header.recordCapacity ? table : best);
}

function optionalLargestTable(franchise: FranchiseLike, name: string): TableLike | null {
  const tables = franchise.getAllTablesByName(name) ?? [];
  if (!tables.length) return null;
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
  if (!field?.isReference) return null;
  const tableId = Number(field.referenceData?.tableId ?? 0);
  const rowNumber = Number(field.referenceData?.rowNumber ?? -1);
  if (!Number.isFinite(tableId) || tableId <= 0 || !Number.isFinite(rowNumber) || rowNumber < 0) return null;
  return { tableId, rowNumber };
}

function refFromField(field: ReferenceField | undefined): ReferenceData | null {
  if (!field?.isReference) return null;
  const tableId = Number(field.referenceData?.tableId ?? 0);
  const rowNumber = Number(field.referenceData?.rowNumber ?? -1);
  if (!Number.isFinite(tableId) || tableId <= 0 || !Number.isFinite(rowNumber) || rowNumber < 0) return null;
  return { tableId, rowNumber };
}

async function ensureRead(table: TableLike | null | undefined): Promise<TableLike | null> {
  if (!table) return null;
  if (!table.recordsRead) await table.readRecords();
  return table;
}

async function referencedRecord(franchise: FranchiseLike, reference: ReferenceData | null): Promise<RecordLike | null> {
  if (!reference) return null;
  try {
    const table = await ensureRead(franchise.getTableById(reference.tableId));
    const record = table?.records[reference.rowNumber];
    return record && !record.isEmpty ? record : null;
  } catch {
    return null;
  }
}

function recordRow(record: RecordLike, fallback: number): number {
  const index = Number(record.index);
  return Number.isFinite(index) ? index : fallback;
}

function teamIdentity(record: RecordLike, row: number): TeamRef {
  const displayName = str(record, 'DisplayName') || str(record, 'LongName') || str(record, 'ShortName');
  const longName = str(record, 'LongName') || displayName;
  const nickname = str(record, 'NickName');
  const teamIndex = num(record, 'TeamIndex', row);
  return { row, teamIndex, displayName, longName, nickname, label: `${displayName} ${nickname}`.trim() };
}

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

function gameStatusIsFinal(status: string): boolean {
  const value = status.toLowerCase();
  return value.includes('won') || value.includes('tie') || value === 'final' || value.includes('complete');
}

function resolveSeasonYear(periodIndex: number, baseCalendarYear: number, currentSeasonYear: number): number {
  if (!Number.isFinite(periodIndex)) return currentSeasonYear || baseCalendarYear;
  if (periodIndex >= 2000) return periodIndex;
  return (baseCalendarYear || currentSeasonYear) + periodIndex;
}

async function readConferenceChampions(
  franchise: FranchiseLike,
  baseCalendarYear: number,
  currentSeasonYear: number,
  teamByRow: Map<number, TeamRef>,
): Promise<ConferenceChampion[]> {
  const result: ConferenceChampion[] = [];
  const manager = optionalLargestTable(franchise, 'LeagueHistoryManager');
  if (!manager) return result;
  await manager.readRecords();
  const managerRecord = nonEmpty(manager.records)[0];
  if (!managerRecord) return result;

  const historyArrayRecord = await referencedRecord(franchise, ref(managerRecord, 'LeagueHistory'));
  if (!historyArrayRecord) return result;

  for (const historyField of historyArrayRecord.fieldsArray ?? Object.values(historyArrayRecord.fields ?? {})) {
    const yearSummary = await referencedRecord(franchise, refFromField(historyField));
    if (!yearSummary) continue;
    const periodIndex = num(yearSummary, 'PeriodIndex');
    const seasonYear = resolveSeasonYear(periodIndex, baseCalendarYear, currentSeasonYear);
    const championsArray = await referencedRecord(franchise, ref(yearSummary, 'ConferenceChampions'));
    if (!championsArray) continue;

    for (const championField of championsArray.fieldsArray ?? Object.values(championsArray.fields ?? {})) {
      const championRecord = await referencedRecord(franchise, refFromField(championField));
      if (!championRecord) continue;
      const rawConference = str(championRecord, 'ConferenceName');
      const winningRef = ref(championRecord, 'WinningTeamIdentity');
      const losingRef = ref(championRecord, 'LosingTeamIdentity');
      const winningTeam = winningRef ? teamByRow.get(winningRef.rowNumber) ?? null : null;
      const losingTeam = losingRef ? teamByRow.get(losingRef.rowNumber) ?? null : null;
      const championName = str(championRecord, 'WinningTeamName') || winningTeam?.displayName || '';
      const runnerUpName = str(championRecord, 'LosingTeamName') || losingTeam?.displayName || '';
      if (!rawConference && !championName) continue;
      result.push({
        seasonYear,
        conferenceName: canonicalConference(rawConference),
        championTeamIndex: winningTeam?.teamIndex ?? null,
        championName: championName || 'Unknown',
        championScore: num(championRecord, 'WinningTeamScore'),
        championWins: num(championRecord, 'WinningTeamWins'),
        championLosses: num(championRecord, 'WinningTeamLosses'),
        runnerUpTeamIndex: losingTeam?.teamIndex ?? null,
        runnerUpName,
        runnerUpScore: num(championRecord, 'LosingTeamScore'),
      });
    }
  }

  const seen = new Set<string>();
  return result
    .filter((item) => {
      const key = `${item.seasonYear}|${item.conferenceName}|${item.championName}|${item.runnerUpName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.seasonYear - a.seasonYear || a.conferenceName.localeCompare(b.conferenceName));
}

export async function loadDynastySnapshot(filePath: string): Promise<DynastySnapshot> {
  const opened = await Franchise.create(filePath);
  const franchise = opened as unknown as FranchiseLike;

  const seasonInfoTable = largestTable(franchise, 'SeasonInfo');
  const teamTable = largestTable(franchise, 'Team');
  const conferenceTable = largestTable(franchise, 'Conference');
  await Promise.all([seasonInfoTable.readRecords(), teamTable.readRecords(), conferenceTable.readRecords()]);

  const seasonInfo = nonEmpty(seasonInfoTable.records)[0] ?? seasonInfoTable.records[0];
  const seasonYear = num(seasonInfo, 'CurrentSeasonYear') || num(seasonInfo, 'CurrentYear');
  const baseCalendarYear = num(seasonInfo, 'BaseCalendarYear') || seasonYear;

  const teamByRow = new Map<number, TeamRef>();
  const teamRecordByRow = new Map<number, RecordLike>();
  teamTable.records.forEach((record, index) => {
    if (!record || record.isEmpty) return;
    const row = recordRow(record, index);
    const identity = teamIdentity(record, row);
    if (!identity.displayName || /^FCS\b/i.test(identity.displayName)) return;
    teamByRow.set(row, identity);
    teamRecordByRow.set(row, record);
  });

  const conferenceByTeamRow = new Map<number, { name: string; enum: string }>();
  for (const conferenceRecord of nonEmpty(conferenceTable.records)) {
    const rawName = str(conferenceRecord, 'Name') || str(conferenceRecord, 'ConferenceEnum');
    if (!rawName) continue;
    const conf = { name: canonicalConference(rawName), enum: str(conferenceRecord, 'ConferenceEnum') };
    const slots = await referencedRecord(franchise, ref(conferenceRecord, 'TeamSlots'));
    if (!slots) continue;
    for (const slotField of slots.fieldsArray ?? Object.values(slots.fields ?? {})) {
      const teamReference = refFromField(slotField);
      if (!teamReference) continue;
      if (!teamByRow.has(teamReference.rowNumber)) continue;
      conferenceByTeamRow.set(teamReference.rowNumber, conf);
    }
  }

  const teams: TeamSeason[] = [];
  for (const [row, identity] of teamByRow.entries()) {
    const record = teamRecordByRow.get(row)!;
    const conference = conferenceByTeamRow.get(row) ?? null;
    const confWins = num(record, 'ConfWin');
    const confLosses = num(record, 'ConfLoss');
    const confTies = num(record, 'ConfTie');
    const nonConfWins = num(record, 'NonConfWin');
    const nonConfLosses = num(record, 'NonConfLoss');
    const nonConfTies = num(record, 'NonConfTie');
    teams.push({
      ...identity,
      conference: conference?.name ?? null,
      conferenceEnum: conference?.enum ?? null,
      overallWins: confWins + nonConfWins,
      overallLosses: confLosses + nonConfLosses,
      overallTies: confTies + nonConfTies,
      confWins,
      confLosses,
      confTies,
      conferenceStanding: num(record, 'CurSeasonConfStanding'),
      cfpRank: num(record, 'CFPPoll_CurrentRank'),
      mediaRank: num(record, 'MediaPoll_CurrentRank'),
      coachesRank: num(record, 'CoachesPoll_CurrentRank'),
    });
  }
  teams.sort((a, b) => (a.conference ?? '').localeCompare(b.conference ?? '') || a.displayName.localeCompare(b.displayName));

  const games: GameResult[] = [];
  const gameTable = optionalLargestTable(franchise, 'SeasonGame');
  if (gameTable) {
    await gameTable.readRecords();
    gameTable.records.forEach((record, index) => {
      if (!record || record.isEmpty || record.IsPractice === true) return;
      const homeReference = ref(record, 'HomeTeam');
      const awayReference = ref(record, 'AwayTeam');
      const home = homeReference ? teamByRow.get(homeReference.rowNumber) ?? null : null;
      const away = awayReference ? teamByRow.get(awayReference.rowNumber) ?? null : null;
      if (!home && !away) return;
      const gameStatus = str(record, 'GameStatus');
      const homeScore = num(record, 'HomeScore');
      const awayScore = num(record, 'AwayScore');
      const isFinal = gameStatusIsFinal(gameStatus) || ((homeScore > 0 || awayScore > 0) && str(record, 'HomeTeamStatus').toLowerCase() !== 'pending');
      games.push({
        row: recordRow(record, index),
        seasonYear: num(record, 'SeasonYear', seasonYear),
        seasonWeek: num(record, 'SeasonWeek'),
        seasonWeekType: str(record, 'SeasonWeekType'),
        homeTeamIndex: home?.teamIndex ?? null,
        awayTeamIndex: away?.teamIndex ?? null,
        homeName: home?.displayName ?? '',
        awayName: away?.displayName ?? '',
        homeScore,
        awayScore,
        gameStatus,
        isFinal,
      });
    });
  }

  const conferenceChampions = await readConferenceChampions(franchise, baseCalendarYear, seasonYear, teamByRow);
  const normalizedPath = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  const dynastyId = crypto.createHash('sha1').update(normalizedPath).digest('hex').slice(0, 16);

  return {
    filePath,
    dynastyId,
    importedAt: new Date().toISOString(),
    seasonYear,
    baseCalendarYear,
    currentWeek: num(seasonInfo, 'CurrentWeek'),
    currentWeekType: str(seasonInfo, 'CurrentWeekType'),
    currentStage: str(seasonInfo, 'CurrentStage'),
    teams,
    games,
    conferenceChampions,
  };
}

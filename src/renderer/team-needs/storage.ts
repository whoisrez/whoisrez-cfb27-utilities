// Team Needs settings saved in the browser's localStorage. Key names are kept
// from earlier releases so existing manual values carry over.
const MANUAL_KEY = 'cfb27-team-needs-v1';
const LAST_TEAM_KEY = 'cfb27-combined-team-needs-last-team-index';
const NEEDS_ONLY_KEY = 'cfb27-team-needs-filter-needs-only';

export type ManualField = 'transferring' | 'projectedDraft' | 'beingCut' | 'recruited';
export type ManualRow = Record<ManualField, number>;
type ManualStore = Record<string, Record<string, ManualRow>>;

function clampManual(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(85, Math.trunc(parsed)));
}

function scope(teamIndex: number | null): string {
  return teamIndex == null ? 'no-team' : `team-index:${teamIndex}`;
}

function readStore(): ManualStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(MANUAL_KEY) ?? '{}') as ManualStore;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function manualValues(teamIndex: number | null, groupKey: string): ManualRow {
  const row = readStore()[scope(teamIndex)]?.[groupKey];
  return {
    transferring: clampManual(row?.transferring),
    projectedDraft: clampManual(row?.projectedDraft),
    beingCut: clampManual(row?.beingCut),
    recruited: clampManual(row?.recruited),
  };
}

export function saveManualValues(teamIndex: number | null, groupKey: string, values: Partial<ManualRow>): void {
  const store = readStore();
  const scoped = store[scope(teamIndex)] ?? {};
  const current = scoped[groupKey] ?? { transferring: 0, projectedDraft: 0, beingCut: 0, recruited: 0 };
  const next = { ...current };
  for (const [field, value] of Object.entries(values) as Array<[ManualField, unknown]>) next[field] = clampManual(value);
  scoped[groupKey] = next;
  store[scope(teamIndex)] = scoped;
  localStorage.setItem(MANUAL_KEY, JSON.stringify(store));
}

export function clearManualValues(teamIndex: number | null): void {
  const store = readStore();
  delete store[scope(teamIndex)];
  localStorage.setItem(MANUAL_KEY, JSON.stringify(store));
}

export function rememberedTeamIndex(): number {
  const raw = localStorage.getItem(LAST_TEAM_KEY);
  return raw == null ? Number.NaN : Number(raw);
}

export function rememberTeamIndex(teamIndex: number): void {
  localStorage.setItem(LAST_TEAM_KEY, String(teamIndex));
}

export function loadNeedsOnly(): boolean {
  return localStorage.getItem(NEEDS_ONLY_KEY) === 'true';
}

export function saveNeedsOnly(value: boolean): void {
  localStorage.setItem(NEEDS_ONLY_KEY, String(value));
}

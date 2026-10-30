import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DynastyHistory, DynastySnapshot, HistoryStore, Movement, StoredSeason } from '../shared/types';

/**
 * Promotion/Relegation history lives in one JSON file in the app's data folder.
 * Each dynasty keeps one entry per season with a locked review snapshot, the
 * latest synced snapshot, and the movements recorded when the season closed.
 */
export class HistoryStoreFile {
  constructor(private readonly dataDir: () => string) {}

  private filePath(): string {
    return path.join(this.dataDir(), 'promotion-relegation-history.json');
  }

  async read(): Promise<HistoryStore> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath(), 'utf8')) as HistoryStore;
      if (parsed?.version === 1 && parsed.dynasties) {
        for (const dynasty of Object.values(parsed.dynasties)) {
          for (const season of dynasty.seasons) normalizeStoredSeason(season);
        }
        return parsed;
      }
    } catch { /* fresh store */ }
    return { version: 1, dynasties: {} };
  }

  async write(store: HistoryStore): Promise<void> {
    await mkdir(this.dataDir(), { recursive: true });
    await writeFile(this.filePath(), JSON.stringify(store, null, 2), 'utf8');
  }

  /** Record an imported/synced snapshot and return the dynasty's updated history. */
  async registerImport(snapshot: DynastySnapshot): Promise<DynastyHistory> {
    const store = await this.read();
    const dynasty: DynastyHistory = store.dynasties[snapshot.dynastyId] ?? {
      dynastyId: snapshot.dynastyId,
      label: path.basename(snapshot.filePath),
      savePath: snapshot.filePath,
      seasons: [],
    };
    dynasty.label = path.basename(snapshot.filePath);
    dynasty.savePath = snapshot.filePath;

    const season = dynasty.seasons.find((item) => item.seasonYear === snapshot.seasonYear);
    if (!season) {
      dynasty.seasons.push({
        seasonYear: snapshot.seasonYear,
        closed: false,
        closedAt: null,
        reopenedAt: null,
        snapshot,
        latestSnapshot: snapshot,
        reviewLockedAt: isReviewReady(snapshot) ? snapshot.importedAt : null,
        movements: [],
      });
    } else {
      normalizeStoredSeason(season);
      season.latestSnapshot = snapshot;
      // Once the offseason review is captured (or the season is closed), later
      // syncs only update latestSnapshot so recommendations stay stable.
      if (!season.closed && !season.reviewLockedAt) {
        season.snapshot = snapshot;
        if (isReviewReady(snapshot)) season.reviewLockedAt = snapshot.importedAt;
      }
    }

    dynasty.seasons.sort((a, b) => b.seasonYear - a.seasonYear);
    store.dynasties[snapshot.dynastyId] = dynasty;
    await this.write(store);
    return dynasty;
  }

  async getDynasty(dynastyId: string): Promise<DynastyHistory | null> {
    return (await this.read()).dynasties[dynastyId] ?? null;
  }

  async closeSeason(dynastyId: string, seasonYear: number, movements: Movement[]): Promise<DynastyHistory> {
    return this.updateSeason(dynastyId, seasonYear, (season) => {
      season.movements = movements;
      season.closed = true;
      season.closedAt = new Date().toISOString();
      season.reopenedAt = null;
      season.reviewLockedAt = season.reviewLockedAt ?? season.snapshot.importedAt;
    });
  }

  async reopenSeason(dynastyId: string, seasonYear: number): Promise<{ dynasty: DynastyHistory; season: StoredSeason }> {
    let reopened: StoredSeason | null = null;
    const dynasty = await this.updateSeason(dynastyId, seasonYear, (season) => {
      season.closed = false;
      season.reopenedAt = new Date().toISOString();
      reopened = season;
    });
    return { dynasty, season: reopened! };
  }

  private async updateSeason(dynastyId: string, seasonYear: number, change: (season: StoredSeason) => void): Promise<DynastyHistory> {
    const store = await this.read();
    const dynasty = store.dynasties[dynastyId];
    if (!dynasty) throw new Error('Dynasty history was not found.');
    const season = dynasty.seasons.find((item) => item.seasonYear === seasonYear);
    if (!season) throw new Error('Season was not found.');
    change(season);
    await this.write(store);
    return dynasty;
  }
}

function seasonChampionCount(snapshot: DynastySnapshot): number {
  return snapshot.conferenceChampions.filter((champion) => champion.seasonYear === snapshot.seasonYear).length;
}

/** The offseason review is ready once the save is in the offseason and all ten champions exist. */
export function isReviewReady(snapshot: DynastySnapshot): boolean {
  const phase = `${snapshot.currentStage} ${snapshot.currentWeekType}`.toLowerCase();
  return phase.includes('offseason') && seasonChampionCount(snapshot) >= 10;
}

/** Fill fields that older history files did not store. */
function normalizeStoredSeason(season: StoredSeason): void {
  if (!season.latestSnapshot) season.latestSnapshot = season.snapshot;
  if (season.reviewLockedAt === undefined && (season.closed || isReviewReady(season.snapshot))) {
    season.reviewLockedAt = season.snapshot.importedAt;
  }
}

/** Keep only well-formed movements from renderer input. */
export function cleanMovements(value: unknown): Movement[] {
  if (!Array.isArray(value)) return [];
  return value.filter((movement): movement is Movement => {
    if (!movement || typeof movement !== 'object') return false;
    const item = movement as Partial<Movement>;
    return Number.isFinite(Number(item.teamIndex)) && typeof item.pairKey === 'string' && typeof item.kind === 'string';
  });
}

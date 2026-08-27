import { app } from 'electron';
import { migrateLegacyPromoData } from './legacy-history-migration';

export type TeamNeedsBranding = {
  logoUrl: string;
  color: string;
  alternateColor: string;
  displayName: string;
};

type EspnTeamResponse = {
  team?: {
    displayName?: string;
    shortDisplayName?: string;
    abbreviation?: string;
    color?: string;
    alternateColor?: string;
    logos?: Array<{ href?: string }>;
  };
};

const cache = new Map<string, TeamNeedsBranding | null>();

// This module is loaded by the Electron main process before the app window is
// created. Run the one-time legacy data merge here so old Promotion/Relegation
// seasons are available before the user imports/syncs the dynasty in Utilities.
app.whenReady().then(async () => {
  try {
    const migrated = await migrateLegacyPromoData();
    if (migrated) console.log('Migrated legacy Promotion/Relegation history into CFB 27 Utilities.');
  } catch (error) {
    console.warn('Legacy Promotion/Relegation history migration failed:', error);
  }
});

function normalizeColor(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(text) ? `#${text.toLowerCase()}` : fallback;
}

function candidates(teamName: string): string[] {
  const raw = teamName.trim().toLowerCase();
  const compact = raw.replace(/[^a-z0-9]+/g, '');
  const dashed = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const aliases: Record<string, string[]> = {
    fiu: ['fiu', 'florida-international'],
    ecu: ['ecu', 'east-carolina'],
    cal: ['cal', 'california'],
    byu: ['byu', 'brigham-young'],
    ucf: ['ucf', 'central-florida'],
    usf: ['usf', 'south-florida'],
    uab: ['uab'],
    utep: ['utep'],
    utsa: ['utsa'],
    unlv: ['unlv'],
    smu: ['smu'],
    tcu: ['tcu'],
    lsu: ['lsu'],
    usc: ['usc', 'southern-california'],
    umass: ['umass', 'massachusetts'],
    fau: ['florida-atlantic'],
    fsu: ['florida-state'],
    jmu: ['james-madison'],
    wku: ['western-kentucky'],
    'miami-oh': ['miami-oh', 'miami-ohio'],
  };
  return [...new Set([...(aliases[raw] ?? []), raw, dashed, compact].filter(Boolean))];
}

export async function resolveTeamNeedsBranding(teamName: string): Promise<TeamNeedsBranding | null> {
  const key = teamName.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  for (const candidate of candidates(teamName)) {
    try {
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${encodeURIComponent(candidate)}`, {
        signal: AbortSignal.timeout(4500),
      });
      if (!response.ok) continue;
      const payload = await response.json() as EspnTeamResponse;
      const team = payload.team;
      const href = team?.logos?.find((logo) => typeof logo.href === 'string' && logo.href.length > 0)?.href;
      if (!team || !href) continue;

      const branding: TeamNeedsBranding = {
        logoUrl: href.replace(/^http:/, 'https:'),
        color: normalizeColor(team.color, '#7b3342'),
        alternateColor: normalizeColor(team.alternateColor, '#d6b35a'),
        displayName: String(team.displayName ?? team.shortDisplayName ?? team.abbreviation ?? teamName),
      };
      cache.set(key, branding);
      return branding;
    } catch {
      // Branding is cosmetic and must never block save loading.
    }
  }

  cache.set(key, null);
  return null;
}

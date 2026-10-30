import type { TeamBranding } from '../shared/types';

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

// Team logos/colors come from ESPN's public API. Results (including misses) are
// cached per run; branding is cosmetic and never blocks save loading.
const cache = new Map<string, TeamBranding | null>();

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

export async function resolveTeamBranding(teamName: string): Promise<TeamBranding | null> {
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

      const branding: TeamBranding = {
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

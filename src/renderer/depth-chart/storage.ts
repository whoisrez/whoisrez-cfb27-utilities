// Depth chart settings persist in the app's local storage (inside the portable data folder).
import { DEFAULT_SETTINGS, normalizeSettings, type DcSettings } from '../../shared/depth-chart-settings';

const SETTINGS_KEY = 'cfb27-depth-chart-settings-v1';
const TEAM_KEY = 'cfb27-depth-chart-team-index';

export function loadSettings(): DcSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: DcSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* optional */ }
}

export function rememberedTeam(): number | null {
  try {
    const raw = localStorage.getItem(TEAM_KEY);
    return raw == null ? null : Number(raw);
  } catch { return null; }
}

export function rememberTeam(teamIndex: number): void {
  try { localStorage.setItem(TEAM_KEY, String(teamIndex)); } catch { /* optional */ }
}

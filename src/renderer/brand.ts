// Sidebar brand: the app name until a save is loaded, then the user's team logo and name.
import type { TeamBranding, TeamNeedsApi } from '../shared/types';
import { esc } from './html';

export function createBrand(element: HTMLElement, api: TeamNeedsApi) {
  let activeTeam = '';

  function showDefault(): void {
    element.classList.remove('has-team-identity');
    element.style.removeProperty('--team-primary');
    element.style.removeProperty('--team-secondary');
    element.innerHTML = '<div class="mark">27</div><div class="brand-copy"><span>DYNASTY SYSTEM</span><strong>CFB 27<br>Utilities</strong></div>';
  }

  function showTeam(teamName: string, branding: TeamBranding | null): void {
    const displayName = branding?.displayName || teamName;
    element.classList.add('has-team-identity');
    const setColor = (name: string, value: string | undefined) => (value ? element.style.setProperty(name, value) : element.style.removeProperty(name));
    setColor('--team-primary', branding?.color);
    setColor('--team-secondary', branding?.alternateColor);
    const logo = branding?.logoUrl ? `<img src="${esc(branding.logoUrl)}" alt="${esc(displayName)} logo">` : '27';
    element.innerHTML = `<div class="mark team-mark">${logo}</div><div class="brand-copy"><strong>${esc(displayName)}</strong><small>CFB 27 Utilities</small></div>`;
  }

  showDefault();

  return {
    /** Show a team's identity; branding is cosmetic, so lookup failures fall back to the name. */
    async setTeam(teamName: string): Promise<void> {
      if (!teamName) return;
      activeTeam = teamName;
      const branding = await api.getTeamBranding(teamName).catch(() => null);
      if (activeTeam === teamName) showTeam(teamName, branding);
    },
  };
}

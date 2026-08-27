type TeamBranding = {
  logoUrl: string;
  color: string;
  alternateColor: string;
  displayName: string;
};

type IdentityTeam = {
  teamIndex: number;
  teamName: string;
  isUserControlled: boolean;
};

type IdentityDynasty = {
  teams: IdentityTeam[];
};

type TeamNeedsIdentityAPI = {
  sync: () => Promise<IdentityDynasty>;
  getTeamBranding: (teamName: string) => Promise<TeamBranding | null>;
};

const teamNeedsAPI = (window as unknown as { teamNeedsAPI: TeamNeedsIdentityAPI }).teamNeedsAPI;
const brand = document.querySelector<HTMLElement>('.brand');
const globalImport = document.querySelector<HTMLButtonElement>('#globalImportBtn');
const teamNeedsSync = document.querySelector<HTMLButtonElement>('#teamNeedsSyncBtn');
const teamSelect = document.querySelector<HTMLSelectElement>('#teamNeedsTeamSelectTop');

let activeTeamName = '';
let resolving = false;

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderDefault(): void {
  if (!brand) return;
  brand.classList.remove('has-team-identity');
  brand.style.removeProperty('--team-primary');
  brand.style.removeProperty('--team-secondary');
  brand.innerHTML = `
    <div class="mark">27</div>
    <div class="brand-copy"><span>DYNASTY SYSTEM</span><strong>CFB 27<br>Utilities</strong></div>`;
}

async function renderTeam(teamName: string): Promise<void> {
  if (!brand || !teamName) return;
  activeTeamName = teamName;
  const branding = await teamNeedsAPI.getTeamBranding(teamName).catch(() => null);
  const displayName = branding?.displayName || teamName;
  brand.classList.add('has-team-identity');
  if (branding?.color) brand.style.setProperty('--team-primary', branding.color);
  else brand.style.removeProperty('--team-primary');
  if (branding?.alternateColor) brand.style.setProperty('--team-secondary', branding.alternateColor);
  else brand.style.removeProperty('--team-secondary');
  brand.innerHTML = `
    <div class="mark team-mark">${branding?.logoUrl ? `<img src="${esc(branding.logoUrl)}" alt="${esc(displayName)} logo">` : '27'}</div>
    <div class="brand-copy">
      <span>USER TEAM</span>
      <strong>${esc(displayName)}</strong>
      <small>CFB 27 Utilities</small>
    </div>`;
}

async function resolveFromSharedSave(): Promise<void> {
  if (!brand || resolving) return;
  resolving = true;
  try {
    const loaded = await teamNeedsAPI.sync();
    const userTeams = loaded.teams.filter((team) => team.isUserControlled);
    const selectedValue = teamSelect && !teamSelect.hidden ? Number(teamSelect.value) : Number.NaN;
    const selected = userTeams.find((team) => team.teamIndex === selectedValue);
    const team = selected ?? userTeams[0];
    if (team) await renderTeam(team.teamName);
  } catch {
    // The identity is cosmetic. Leave the default app branding if no save is available.
  } finally {
    resolving = false;
  }
}

function refreshAfter(button: HTMLButtonElement | null): void {
  if (!button) return;
  const started = Date.now();
  let sawBusy = button.disabled;
  const timer = window.setInterval(() => {
    if (button.disabled) sawBusy = true;
    if ((sawBusy && !button.disabled) || Date.now() - started > 50000) {
      window.clearInterval(timer);
      void resolveFromSharedSave();
    }
  }, 75);
}

renderDefault();

globalImport?.addEventListener('click', () => refreshAfter(globalImport));
teamNeedsSync?.addEventListener('click', () => refreshAfter(teamNeedsSync));
teamSelect?.addEventListener('change', () => {
  const option = teamSelect.selectedOptions[0];
  const name = option?.textContent?.replace(/\s*•\s*User\s*$/, '').trim();
  if (name && name !== activeTeamName) void renderTeam(name);
});

type TeamBranding = {
  logoUrl: string;
  color: string;
  alternateColor: string;
  displayName: string;
};

type TeamNeedsBrandingApi = {
  getTeamBranding: (teamName: string) => Promise<TeamBranding | null>;
};

const api = (window as unknown as { teamNeedsAPI: TeamNeedsBrandingApi }).teamNeedsAPI;
let lastTeam = '';
let requestId = 0;
let cachedBranding: TeamBranding | null = null;

function currentTeamName(): string {
  if (document.querySelector('#pageTitle')?.textContent?.trim() !== 'Team Needs') return '';
  const select = document.querySelector<HTMLSelectElement>('#teamNeedsTeamSelectTop');
  if (select && !select.hidden && select.selectedOptions[0]) {
    return String(select.selectedOptions[0].textContent ?? '').replace(/\s*•\s*User\s*$/i, '').trim();
  }
  const status = document.querySelector<HTMLElement>('#status strong')?.textContent ?? '';
  return status.replace(/\s+loaded\.?$/i, '').trim();
}

function apply(teamName: string, branding: TeamBranding | null): void {
  const root = document.documentElement;
  const active = document.body.classList.contains('team-needs-active');
  const mark = document.querySelector<HTMLElement>('.brand .mark');

  if (branding && active) {
    root.style.setProperty('--team-accent', branding.color);
    root.style.setProperty('--team-accent-alt', branding.alternateColor);
  } else {
    root.style.removeProperty('--team-accent');
    root.style.removeProperty('--team-accent-alt');
  }

  if (mark) {
    const existing = mark.querySelector<HTMLImageElement>('.team-logo-image');
    if (branding && active) {
      mark.classList.add('has-team-logo');
      if (!existing) {
        mark.textContent = '';
        const image = document.createElement('img');
        image.className = 'team-logo-image';
        image.alt = '';
        image.src = branding.logoUrl;
        mark.appendChild(image);
      } else if (existing.src !== branding.logoUrl) {
        existing.src = branding.logoUrl;
      }
    } else {
      existing?.remove();
      mark.classList.remove('has-team-logo');
      if (mark.textContent !== '27') mark.textContent = '27';
    }
  }

  const firstCard = document.querySelector<HTMLElement>('.tn-summary article:first-child');
  if (firstCard) {
    const existing = firstCard.querySelector<HTMLImageElement>('.team-needs-summary-watermark');
    if (branding && active) {
      if (!existing) {
        const image = document.createElement('img');
        image.className = 'team-needs-summary-watermark';
        image.alt = '';
        image.src = branding.logoUrl;
        firstCard.appendChild(image);
      } else if (existing.src !== branding.logoUrl) {
        existing.src = branding.logoUrl;
      }
    } else {
      existing?.remove();
    }
  }

  if (teamName && branding && active) document.body.dataset.teamBrand = branding.displayName || teamName;
  else delete document.body.dataset.teamBrand;
}

async function syncBranding(): Promise<void> {
  const active = document.body.classList.contains('team-needs-active');
  const teamName = currentTeamName();
  if (!active || !teamName) {
    lastTeam = '';
    cachedBranding = null;
    apply('', null);
    return;
  }

  if (teamName === lastTeam) {
    apply(teamName, cachedBranding);
    return;
  }

  lastTeam = teamName;
  cachedBranding = null;
  apply(teamName, null);
  const id = ++requestId;
  try {
    const branding = await api.getTeamBranding(teamName);
    if (id !== requestId || currentTeamName() !== teamName) return;
    cachedBranding = branding;
    apply(teamName, branding);
  } catch {
    if (id === requestId) apply(teamName, null);
  }
}

const observer = new MutationObserver(() => queueMicrotask(() => void syncBranding()));
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
document.addEventListener('change', () => void syncBranding());
document.addEventListener('click', () => setTimeout(() => void syncBranding(), 0));
void syncBranding();

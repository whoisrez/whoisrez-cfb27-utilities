import './team-needs-polish.css';

const workspace = document.querySelector<HTMLElement>('.workspace');
const pageTitle = document.querySelector<HTMLElement>('#pageTitle');
const globalImport = document.querySelector<HTMLButtonElement>('#globalImportBtn');
const nav = document.querySelector<HTMLElement>('#nav');

let mask: HTMLElement | null = null;
let cleanupTimer: number | null = null;
let startedFromTeamNeeds = false;

function isTeamNeedsPage(): boolean {
  return pageTitle?.textContent?.trim() === 'Team Needs';
}

function keepOriginNavigationVisible(): void {
  if (!startedFromTeamNeeds || !nav) return;
  const teamNeedsButton = nav.querySelector<HTMLButtonElement>('button[data-tool-page="team-needs"]');
  teamNeedsButton?.classList.add('active');
  nav.querySelectorAll<HTMLButtonElement>('button[data-page]').forEach((button) => button.classList.remove('active'));
  document.body.classList.add('team-needs-active');
}

function showMask(): void {
  if (!workspace || mask) return;
  mask = document.createElement('div');
  mask.className = 'shared-import-mask';
  mask.innerHTML = '<div><strong>Importing Dynasty</strong><span>Loading the selected save for Team Needs and Season…</span></div>';
  workspace.appendChild(mask);
  document.body.classList.add('shared-import-running');
  keepOriginNavigationVisible();
}

function removeMask(): void {
  mask?.remove();
  mask = null;
  document.body.classList.remove('shared-import-running');
  if (cleanupTimer != null) {
    window.clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  startedFromTeamNeeds = false;
}

function waitForTeamNeedsReturn(): void {
  if (cleanupTimer != null) window.clearInterval(cleanupTimer);
  const started = Date.now();
  cleanupTimer = window.setInterval(() => {
    keepOriginNavigationVisible();
    const finished = Boolean(globalImport && !globalImport.disabled && isTeamNeedsPage());
    if (finished || Date.now() - started > 50000) removeMask();
  }, 30);
}

document.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('#globalImportBtn');
  if (!button || button.disabled) return;
  startedFromTeamNeeds = isTeamNeedsPage();
  if (!startedFromTeamNeeds) return;
  showMask();
  waitForTeamNeedsReturn();
}, true);

import './combined-team-needs.css';
import { ROSTER_TARGETS, ROSTER_TARGET_TOTAL } from './config/roster-targets';
import {
  availableTeamNeedsDepartures,
  calculateTeamNeedsStillNeeded,
  normalizeTeamNeedsDepartures,
} from './utils/team-needs';
import type { TeamNeedsDynasty, TeamNeedsPlayer, TeamNeedsTeam } from './team-needs-reader';
import type { DynastySnapshot } from './types';

declare global {
  interface Window {
    teamNeedsAPI: {
      sync: () => Promise<TeamNeedsDynasty>;
    };
  }
}

type PromoBridge = {
  getCurrentSnapshot: () => Promise<DynastySnapshot | null>;
};

type ManualField = 'transferring' | 'projectedDraft' | 'beingCut' | 'recruited';
type ManualRow = Record<ManualField, number>;
type ManualStore = Record<string, Record<string, ManualRow>>;

type SectionDefinition = {
  id: string;
  label: string;
  startKey: string;
};

const STORAGE_KEY = 'cfb27-team-needs-v1';
const LAST_TEAM_KEY = 'cfb27-combined-team-needs-last-team-index';
const NEEDS_ONLY_KEY = 'cfb27-team-needs-filter-needs-only';
const sections: readonly SectionDefinition[] = [
  { id: 'offense', label: 'Offense', startKey: 'QB' },
  { id: 'defense', label: 'Defense', startKey: 'EDGE' },
  { id: 'special-teams', label: 'Special Teams', startKey: 'K' },
];
const positionAliases: Record<string, string> = {
  RB: 'HB', LEDG: 'LE', LDE: 'LE', REDG: 'RE', RDE: 'RE', NT: 'DT',
  LOLB: 'SAM', MLB: 'MIKE', ROLB: 'WILL',
};

let teamNeedsActive = false;
let dynasty: TeamNeedsDynasty | null = null;
let selectedTeamIndex: number | null = null;
let needsOnly = localStorage.getItem(NEEDS_ONLY_KEY) === 'true';

const promoAPI = (window as unknown as { promoAPI: PromoBridge }).promoAPI;
const nav = document.querySelector<HTMLElement>('#nav');
const content = document.querySelector<HTMLElement>('#content');
const status = document.querySelector<HTMLElement>('#status');
const pageTitle = document.querySelector<HTMLElement>('#pageTitle');
const pageSubtitle = document.querySelector<HTMLElement>('#pageSubtitle');
const promoSync = document.querySelector<HTMLButtonElement>('#syncBtn');
const promoImport = document.querySelector<HTMLButtonElement>('#importBtn');
const actions = document.querySelector<HTMLElement>('.topbar .actions');
const brandStrong = document.querySelector<HTMLElement>('.brand strong');
const topbarCopy = pageTitle?.parentElement;

if (!nav || !content || !status || !pageTitle || !pageSubtitle || !promoSync || !promoImport || !actions || !topbarCopy) {
  throw new Error('Combined Team Needs could not find the application shell.');
}

if (brandStrong) brandStrong.innerHTML = 'CFB 27<br>Utilities';

function installCombinedNavigation(): void {
  nav.innerHTML = `
    <div class="combined-nav-label">RECRUITING</div>
    <button data-tool-page="team-needs"><span>01</span>Team Needs</button>
    <div class="combined-nav-label season-label">SEASON</div>
    <button id="seasonToggle" class="combined-section-toggle" type="button"><span>02</span>Promotion / Relegation <b>⌄</b></button>
    <div id="seasonNav" class="combined-subnav open">
      <button data-page="dashboard" class="active">Dashboard</button>
      <button data-page="movement">Promotion / Relegation</button>
      <button data-page="alignment">Current Alignment</button>
      <button data-page="teams">Teams</button>
      <button data-page="conferences">Conferences</button>
      <button data-page="history">History</button>
    </div>`;
}

installCombinedNavigation();

const titleRow = document.createElement('div');
titleRow.className = 'combined-title-row';
pageTitle.insertAdjacentElement('beforebegin', titleRow);
titleRow.appendChild(pageTitle);
promoSync.classList.add('section-sync');
titleRow.appendChild(promoSync);

const teamNeedsSync = document.createElement('button');
teamNeedsSync.id = 'teamNeedsSyncBtn';
teamNeedsSync.className = 'secondary section-sync';
teamNeedsSync.type = 'button';
teamNeedsSync.textContent = 'Sync';
teamNeedsSync.disabled = true;
teamNeedsSync.hidden = true;
titleRow.appendChild(teamNeedsSync);

promoImport.hidden = true;
const globalImport = document.createElement('button');
globalImport.id = 'globalImportBtn';
globalImport.className = 'primary';
globalImport.type = 'button';
globalImport.textContent = 'Import Dynasty';
actions.appendChild(globalImport);

const teamExtras = document.createElement('div');
teamExtras.className = 'team-needs-top-extras';
teamExtras.innerHTML = `
  <select id="teamNeedsTeamSelectTop" class="team-needs-top-select" aria-label="Team" hidden></select>
  <button id="teamNeedsResetBtnTop" class="secondary" type="button" hidden>Reset Manual Values</button>`;
actions.insertBefore(teamExtras, globalImport);
const teamSelectTop = teamExtras.querySelector<HTMLSelectElement>('#teamNeedsTeamSelectTop')!;
const resetTop = teamExtras.querySelector<HTMLButtonElement>('#teamNeedsResetBtnTop')!;

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function saveFileName(filePath: string): string {
  const parts = String(filePath || '').split(/[\\/]/);
  return parts[parts.length - 1] || 'Dynasty save';
}

function currentTeam(): TeamNeedsTeam | null {
  if (!dynasty || selectedTeamIndex == null) return null;
  return dynasty.teams.find((team) => team.teamIndex === selectedTeamIndex) ?? null;
}

function displayPosition(position: string): string {
  return positionAliases[position] ?? position;
}

function isGraduatingSenior(player: TeamNeedsPlayer): boolean {
  return player.schoolYear === 'Senior' && player.redshirtStatus !== 'Current';
}

function clampManual(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(85, Math.trunc(parsed)));
}

function storageScope(): string {
  return selectedTeamIndex == null ? 'no-team' : `team-index:${selectedTeamIndex}`;
}

function readStore(): ManualStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ManualStore;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function manualValues(groupKey: string): ManualRow {
  const row = readStore()[storageScope()]?.[groupKey];
  return {
    transferring: clampManual(row?.transferring),
    projectedDraft: clampManual(row?.projectedDraft),
    beingCut: clampManual(row?.beingCut),
    recruited: clampManual(row?.recruited),
  };
}

function saveManual(groupKey: string, field: ManualField, value: unknown): void {
  const store = readStore();
  const scope = storageScope();
  const scoped = store[scope] ?? {};
  const current = scoped[groupKey] ?? { transferring: 0, projectedDraft: 0, beingCut: 0, recruited: 0 };
  scoped[groupKey] = { ...current, [field]: clampManual(value) };
  store[scope] = scoped;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function clearManualValues(): void {
  const store = readStore();
  delete store[storageScope()];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  renderTeamNeeds();
}

function autoRecruited(team: TeamNeedsTeam, positions: readonly string[]): number {
  return team.recruits.filter((recruit) => positions.includes(displayPosition(recruit.position))).length;
}

function selectableTeams(): TeamNeedsTeam[] {
  if (!dynasty) return [];
  const userTeams = dynasty.teams.filter((team) => team.isUserControlled);
  return userTeams.length ? userTeams : dynasty.teams;
}

function selectDefaultTeam(loaded: TeamNeedsDynasty): void {
  const candidates = loaded.teams.filter((team) => team.isUserControlled);
  const available = candidates.length ? candidates : loaded.teams;
  const rememberedRaw = localStorage.getItem(LAST_TEAM_KEY);
  const remembered = rememberedRaw == null ? Number.NaN : Number(rememberedRaw);
  const rememberedTeam = available.find((team) => team.teamIndex === remembered);
  if (available.length === 1) selectedTeamIndex = available[0].teamIndex;
  else if (selectedTeamIndex != null && available.some((team) => team.teamIndex === selectedTeamIndex)) {
    // Preserve current selection on Sync.
  } else selectedTeamIndex = rememberedTeam?.teamIndex ?? available[0]?.teamIndex ?? null;
  if (selectedTeamIndex != null) localStorage.setItem(LAST_TEAM_KEY, String(selectedTeamIndex));
}

function renderTeamSelectTop(): void {
  const teams = selectableTeams();
  const showSelector = teamNeedsActive && teams.length > 1;
  teamSelectTop.hidden = !showSelector;
  if (!showSelector) return;
  teamSelectTop.innerHTML = teams.map((team) =>
    `<option value="${team.teamIndex}"${team.teamIndex === selectedTeamIndex ? ' selected' : ''}>${esc(team.teamName)}${team.isUserControlled ? ' • User' : ''}</option>`,
  ).join('');
}

function setTeamNeedsShell(active: boolean): void {
  teamNeedsActive = active;
  document.body.classList.toggle('team-needs-active', active);
  promoSync.hidden = active;
  teamNeedsSync.hidden = !active;
  resetTop.hidden = !active || !currentTeam();
  renderTeamSelectTop();
  nav.querySelectorAll('button').forEach((button) => {
    const el = button as HTMLButtonElement;
    if (el.dataset.toolPage === 'team-needs') el.classList.toggle('active', active);
    else if (active && el.dataset.page) el.classList.remove('active');
  });
}

function sectionDivider(groupKey: string): string {
  const section = sections.find((item) => item.startKey === groupKey);
  if (!section) return '';
  return `<tr class="roster-section-divider" data-section="${section.id}"><td colspan="9">${section.label}</td></tr>`;
}

function renderTeamNeeds(): void {
  if (!teamNeedsActive) return;
  const team = currentTeam();
  pageTitle.textContent = 'Team Needs';
  pageSubtitle.textContent = 'Weekly roster planning and committed-recruit tracking.';
  teamNeedsSync.disabled = !dynasty;
  resetTop.hidden = !team;
  renderTeamSelectTop();

  if (!dynasty) {
    status.innerHTML = '<span><strong>No dynasty loaded.</strong> Use Import Dynasty to choose the save used by both sections.</span><span>Team Needs Sync is independent from Season Sync.</span>';
    content.innerHTML = `<div class="team-needs-view">
      <section class="tn-summary">
        <article><span>Roster</span><strong>— / ${ROSTER_TARGET_TOTAL}</strong><small>Import dynasty</small></article>
        <article><span>Graduating</span><strong>—</strong><small>Projected departures</small></article>
        <article><span>Projected Returning</span><strong>—</strong><small>After departures</small></article>
        <article><span>Still Needed</span><strong>—</strong><small>Net to target</small></article>
      </section>
      <section class="tn-panel"><div class="tn-panel-head"><div><span class="eyebrow">85-MAN ROSTER PLAN</span><h2>Team Needs</h2></div></div><div class="tn-empty">Import a CFB 27 dynasty save to populate the chart.</div></section>
    </div>`;
    return;
  }

  if (!team) {
    status.innerHTML = `<span><strong>Dynasty loaded.</strong> ${dynasty.teams.length} team rosters found.</span><span>Select your school.</span>`;
    content.innerHTML = `<div class="team-needs-view"><section class="tn-panel"><div class="tn-empty">Select your school above to populate the chart.</div></section></div>`;
    return;
  }

  const values = ROSTER_TARGETS.map((group) => {
    const players = team.roster.filter((player) => group.positions.includes(displayPosition(player.position)));
    const graduating = players.filter(isGraduatingSenior).length;
    const manual = manualValues(group.key);
    const normalized = normalizeTeamNeedsDepartures(
      players.length,
      graduating,
      manual.transferring,
      manual.projectedDraft,
      manual.beingCut,
    );
    const recruited = team.recruitingAuto ? autoRecruited(team, group.positions) : manual.recruited;
    const available = availableTeamNeedsDepartures(players.length, graduating);
    const stillNeeded = calculateTeamNeedsStillNeeded(
      group.target,
      players.length,
      graduating,
      normalized.transferring,
      normalized.projectedDraft,
      normalized.beingCut,
      recruited,
    );
    return { group, onTeam: players.length, graduating, ...normalized, recruited, available, stillNeeded };
  });

  const totalGraduating = values.reduce((sum, row) => sum + row.graduating, 0);
  const totalTransferring = values.reduce((sum, row) => sum + row.transferring, 0);
  const totalProjectedDraft = values.reduce((sum, row) => sum + row.projectedDraft, 0);
  const totalBeingCut = values.reduce((sum, row) => sum + row.beingCut, 0);
  const totalRecruited = values.reduce((sum, row) => sum + row.recruited, 0);
  const totalStillNeeded = values.reduce((sum, row) => sum + row.stillNeeded, 0);
  const projectedReturning = team.roster.length - totalGraduating - totalTransferring - totalProjectedDraft - totalBeingCut;

  status.innerHTML = `<span><strong>${esc(team.teamName)} loaded.</strong> ${team.roster.length} players read from ${esc(saveFileName(dynasty.filePath))}.</span><span>${team.recruitingAuto ? `${totalRecruited} committed recruits auto-read.` : 'Recruited remains manual for this save.'}</span>`;

  const rows = values.map((row) => {
    const hidden = needsOnly && row.stillNeeded <= 0 ? ' needs-filter-hidden' : '';
    const needClass = row.stillNeeded > 0 ? 'need-positive' : row.stillNeeded < 0 ? 'need-surplus' : 'need-balanced';
    const statusText = row.stillNeeded > 0 ? `${row.stillNeeded} to add` : row.stillNeeded < 0 ? `${Math.abs(row.stillNeeded)} over target` : 'On target';
    const maxTransferring = Math.max(0, row.available - row.projectedDraft - row.beingCut);
    const maxProjectedDraft = Math.max(0, row.available - row.transferring - row.beingCut);
    const maxBeingCut = Math.max(0, row.available - row.transferring - row.projectedDraft);
    const recruitedInput = `<div class="manual-wrap"><input class="tn-manual" type="number" min="0" max="85" step="1" data-manual-field="recruited" value="${row.recruited}"${team.recruitingAuto ? ' readonly' : ''}>${team.recruitingAuto ? '<small>auto</small>' : ''}</div>`;
    return `${sectionDivider(row.group.key)}<tr class="${hidden.trim()}" data-target-group="${esc(row.group.key)}" data-on-team="${row.onTeam}" data-graduating="${row.graduating}" data-target="${row.group.target}">
      <td><div class="position-name"><strong>${esc(row.group.label)}</strong><small>${esc(row.group.key)}</small></div></td>
      <td><span class="count">${row.onTeam}</span></td>
      <td><span class="count departing">${row.graduating}</span></td>
      <td><div class="manual-wrap"><input class="tn-manual" type="number" min="0" max="${maxTransferring}" step="1" data-manual-field="transferring" value="${row.transferring}"><small>max ${row.available} combined</small></div></td>
      <td><div class="manual-wrap"><input class="tn-manual" type="number" min="0" max="${maxProjectedDraft}" step="1" data-manual-field="projectedDraft" value="${row.projectedDraft}"></div></td>
      <td><div class="manual-wrap"><input class="tn-manual" type="number" min="0" max="${maxBeingCut}" step="1" data-manual-field="beingCut" value="${row.beingCut}"></div></td>
      <td><span class="target">${row.group.target}</span></td>
      <td>${recruitedInput}</td>
      <td><div class="need-result"><strong class="still-needed ${needClass}">${row.stillNeeded}</strong><small>${statusText}</small></div></td>
    </tr>`;
  }).join('');

  content.innerHTML = `<div class="team-needs-view">
    <section class="tn-summary">
      <article><span>Roster</span><strong>${team.roster.length} / ${ROSTER_TARGET_TOTAL}</strong><small>Current / target</small></article>
      <article><span>Graduating</span><strong>${totalGraduating}</strong><small>Projected departures</small></article>
      <article><span>Projected Returning</span><strong>${projectedReturning}</strong><small>After manual departures</small></article>
      <article><span>Still Needed</span><strong>${totalStillNeeded}</strong><small>${totalRecruited} recruited${team.recruitingAuto ? ' • auto' : ''}</small></article>
    </section>
    <section class="tn-panel">
      <div class="tn-panel-head"><div><span class="eyebrow">85-MAN ROSTER PLAN</span><h2>Team Needs</h2></div><div class="tn-panel-actions"><div class="tn-panel-meta">${esc(team.teamName)} • ${team.roster.length} on roster • ${projectedReturning} projected returning</div><button id="needsOnlyToggle" class="needs-only-toggle${needsOnly ? ' active' : ''}" type="button" aria-pressed="${needsOnly}"><span class="toggle-dot"></span><span>Needs Only</span></button></div></div>
      <div class="tn-table-wrap"><table class="needs-table"><thead><tr><th>Position</th><th>On Team</th><th>Graduating</th><th>Transferring</th><th>Projected Draft</th><th>Being Cut</th><th>Target</th><th>Recruited</th><th>Still Needed</th></tr></thead><tbody>${rows}<tr class="total-row"><td><strong>Total</strong></td><td><strong>${team.roster.length}</strong></td><td><strong>${totalGraduating}</strong></td><td><strong>${totalTransferring}</strong></td><td><strong>${totalProjectedDraft}</strong></td><td><strong>${totalBeingCut}</strong></td><td><strong>${ROSTER_TARGET_TOTAL}</strong></td><td><strong>${totalRecruited}</strong></td><td><strong>${totalStillNeeded}</strong></td></tr></tbody></table></div>
    </section>
    <p class="tn-footnote"><b>Roster-safe departures:</b> Transferring + Projected Draft + Being Cut can never exceed the non-graduating players available in that position group. Committed recruits auto-populate when available. LG + RG count as OG, LT + RT as OT, LE + RE as EDGE, and SAM + WILL as SAM/WILL.</p>
  </div>`;
}

function refreshManualRow(row: HTMLTableRowElement): void {
  const groupKey = row.dataset.targetGroup;
  if (!groupKey) return;
  const onTeam = Number(row.dataset.onTeam ?? 0);
  const graduating = Number(row.dataset.graduating ?? 0);
  const transferring = row.querySelector<HTMLInputElement>('input[data-manual-field="transferring"]');
  const projectedDraft = row.querySelector<HTMLInputElement>('input[data-manual-field="projectedDraft"]');
  const beingCut = row.querySelector<HTMLInputElement>('input[data-manual-field="beingCut"]');
  if (!transferring || !projectedDraft || !beingCut) return;
  const normalized = normalizeTeamNeedsDepartures(onTeam, graduating, transferring.value, projectedDraft.value, beingCut.value);
  saveManual(groupKey, 'transferring', normalized.transferring);
  saveManual(groupKey, 'projectedDraft', normalized.projectedDraft);
  saveManual(groupKey, 'beingCut', normalized.beingCut);
  const recruited = row.querySelector<HTMLInputElement>('input[data-manual-field="recruited"]');
  if (recruited && !recruited.readOnly) saveManual(groupKey, 'recruited', recruited.value);
  renderTeamNeeds();
}

function waitForHiddenPromoImport(): Promise<void> {
  return new Promise((resolve) => {
    let sawBusy = promoImport.disabled;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (promoImport.disabled) sawBusy = true;
      if ((sawBusy && !promoImport.disabled) || Date.now() - started > 45000) {
        window.clearInterval(timer);
        resolve();
      }
    }, 50);
  });
}

async function loadTeamNeedsFromSharedSave(): Promise<void> {
  const loaded = await window.teamNeedsAPI.sync();
  dynasty = loaded;
  selectDefaultTeam(loaded);
}

nav.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!target) return;
  if (target.id === 'seasonToggle') {
    event.preventDefault();
    event.stopPropagation();
    nav.querySelector('#seasonNav')?.classList.toggle('open');
    return;
  }
  if (target.dataset.toolPage === 'team-needs') {
    event.preventDefault();
    event.stopPropagation();
    setTeamNeedsShell(true);
    renderTeamNeeds();
    return;
  }
  if (target.dataset.page) setTeamNeedsShell(false);
}, true);

globalImport.addEventListener('click', async () => {
  if (globalImport.disabled || promoImport.disabled) return;
  const returnToTeamNeeds = teamNeedsActive;
  const before = await promoAPI.getCurrentSnapshot();
  globalImport.disabled = true;
  globalImport.textContent = 'Reading Save…';
  promoImport.click();
  await waitForHiddenPromoImport();
  try {
    const after = await promoAPI.getCurrentSnapshot();
    const changed = Boolean(after && (!before || after.importedAt !== before.importedAt || after.filePath !== before.filePath));
    if (changed) await loadTeamNeedsFromSharedSave();
    if (returnToTeamNeeds) {
      setTeamNeedsShell(true);
      renderTeamNeeds();
    }
  } catch (error) {
    if (returnToTeamNeeds) {
      setTeamNeedsShell(true);
      status.innerHTML = `<span><strong>Team Needs load failed.</strong> ${esc(error instanceof Error ? error.message : String(error))}</span><span>The Season import completed.</span>`;
    }
  } finally {
    globalImport.disabled = false;
    globalImport.textContent = 'Import Dynasty';
  }
});

teamNeedsSync.addEventListener('click', async () => {
  if (!dynasty) return;
  teamNeedsSync.disabled = true;
  teamNeedsSync.textContent = 'Syncing…';
  try {
    await loadTeamNeedsFromSharedSave();
    renderTeamNeeds();
  } catch (error) {
    status.innerHTML = `<span><strong>Team Needs sync failed.</strong> ${esc(error instanceof Error ? error.message : String(error))}</span><span>Season data was not touched.</span>`;
  } finally {
    teamNeedsSync.disabled = !dynasty;
    teamNeedsSync.textContent = 'Sync';
  }
});

resetTop.addEventListener('click', clearManualValues);

teamSelectTop.addEventListener('change', () => {
  const parsed = Number(teamSelectTop.value);
  selectedTeamIndex = Number.isFinite(parsed) ? parsed : null;
  if (selectedTeamIndex != null) localStorage.setItem(LAST_TEAM_KEY, String(selectedTeamIndex));
  renderTeamNeeds();
});

content.addEventListener('change', (event) => {
  if (!teamNeedsActive) return;
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-manual-field]');
  if (!input) return;
  const row = input.closest<HTMLTableRowElement>('tr[data-target-group]');
  if (row) refreshManualRow(row);
});

content.addEventListener('click', (event) => {
  if (!teamNeedsActive) return;
  const toggle = (event.target as HTMLElement).closest<HTMLButtonElement>('#needsOnlyToggle');
  if (!toggle) return;
  needsOnly = !needsOnly;
  localStorage.setItem(NEEDS_ONLY_KEY, String(needsOnly));
  renderTeamNeeds();
});

setTeamNeedsShell(false);

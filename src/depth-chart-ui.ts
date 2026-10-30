import './depth-chart.css';
import type { DepthChartLoad, DepthChartWriteRequest } from './depth-chart-save';
import type { DcSlotPlan, SlotKey } from './depth-chart-rules';
import type { DynastySnapshot } from './types';

type SaveResult = {
  outputPath: string;
  backupPath: string | null;
  writtenSlots: number;
  writtenEntries: number;
  verifiedSlots: number;
};

type DepthChartBridge = {
  load: (filePath: string, teamIndex?: number | null) => Promise<DepthChartLoad>;
  write: (filePath: string, request: DepthChartWriteRequest) => Promise<SaveResult | null>;
};

type PromoBridge = {
  getCurrentSnapshot: () => Promise<DynastySnapshot | null>;
  getLatestSnapshot: () => Promise<DynastySnapshot | null>;
};

const TEAM_KEY = 'cfb27-depth-chart-team-index';
const SLOT_POSITIONS: Record<SlotKey, string[]> = {
  LE: ['LE'], RE: ['RE'], DT: ['DT'], LOLB: ['LOLB'], MLB: ['MLB'], ROLB: ['ROLB'], CB: ['CB'], FS: ['FS'], SS: ['SS'],
  RLE: ['LE'], RRE: ['RE'], RDT: ['DT'], NT: ['DT'], SUBLB: ['MLB'], SLCB: ['CB'],
};
const SLOT_HELP: Record<SlotKey, string> = {
  LE: 'Left edge', RE: 'Right edge', DT: 'Defensive tackle · top 2 start in 4-man fronts', LOLB: 'Strong-side linebacker',
  MLB: 'Middle linebacker · top 2 start in 3-4 looks', ROLB: 'Weak-side linebacker', CB: 'Cornerback · top 2 start',
  FS: 'Free safety', SS: 'Strong safety', RLE: 'Pass-rush left end', RRE: 'Pass-rush right end', RDT: 'Pass-rush tackle',
  NT: 'Nose tackle', SUBLB: 'Nickel / dime linebacker', SLCB: 'Slot corner',
};
const DISPLAY: Record<string, string> = {
  LE: 'LEDG', RE: 'REDG', DT: 'DT', LOLB: 'SAM', MLB: 'MIKE', ROLB: 'WILL', CB: 'CB', FS: 'FS', SS: 'SS',
};

const api = (window as unknown as { depthChartAPI: DepthChartBridge }).depthChartAPI;
const promoAPI = (window as unknown as { promoAPI: PromoBridge }).promoAPI;

const nav = document.querySelector<HTMLElement>('#nav');
const content = document.querySelector<HTMLElement>('#content');
const pageTitle = document.querySelector<HTMLElement>('#pageTitle');
const pageSubtitle = document.querySelector<HTMLElement>('#pageSubtitle');
const titleRow = document.querySelector<HTMLElement>('.combined-title-row');
const promoSync = document.querySelector<HTMLButtonElement>('#syncBtn');
const teamNeedsSync = document.querySelector<HTMLButtonElement>('#teamNeedsSyncBtn');
const teamExtras = document.querySelector<HTMLElement>('.team-needs-top-extras');
const actions = document.querySelector<HTMLElement>('.topbar .actions');
const globalImport = document.querySelector<HTMLButtonElement>('#globalImportBtn');

let active = false;
let data: DepthChartLoad | null = null;
let loadedFrom = '';
let include = new Set<SlotKey>();
let busy = false;
let message: { tone: 'info' | 'success' | 'error'; html: string } | null = null;

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function fileName(filePath: string): string {
  const parts = String(filePath || '').split(/[\\/]/);
  return parts[parts.length - 1] || 'Dynasty save';
}

function prettyArchetype(value: string): string {
  return value.replace(/^[A-Z]+_/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function prettyDev(value: string): string {
  return value.replace(/^College_/, '');
}

const syncButton = document.createElement('button');
syncButton.id = 'depthChartSyncBtn';
syncButton.className = 'secondary section-sync';
syncButton.type = 'button';
syncButton.textContent = 'Sync';
syncButton.hidden = true;
titleRow?.appendChild(syncButton);

const teamSelect = document.createElement('select');
teamSelect.id = 'depthChartTeamSelect';
teamSelect.className = 'team-needs-top-select';
teamSelect.setAttribute('aria-label', 'Team');
teamSelect.hidden = true;
if (actions && globalImport) actions.insertBefore(teamSelect, globalImport);

function installNav(): void {
  if (!nav || nav.querySelector('[data-tool-page="depth-chart"]')) return;
  const label = document.createElement('div');
  label.className = 'combined-nav-label depth-chart-nav-label';
  label.textContent = 'ROSTER';
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.toolPage = 'depth-chart';
  button.textContent = 'Depth Chart';
  const offseason = Array.from(nav.querySelectorAll<HTMLElement>('.combined-nav-label'))
    .find((item) => /offseason|season/i.test(item.textContent ?? ''));
  if (offseason) {
    nav.insertBefore(label, offseason);
    nav.insertBefore(button, offseason);
  } else {
    nav.appendChild(label);
    nav.appendChild(button);
  }
}

async function currentSavePath(): Promise<string> {
  const latest = await promoAPI.getLatestSnapshot().catch(() => null);
  const current = latest ?? await promoAPI.getCurrentSnapshot().catch(() => null);
  return current?.filePath ?? '';
}

function setShell(on: boolean): void {
  active = on;
  document.body.classList.toggle('depth-chart-active', on);
  syncButton.hidden = !on;
  if (on) {
    document.body.classList.remove('team-needs-active');
    if (promoSync) promoSync.hidden = true;
    if (teamNeedsSync) teamNeedsSync.hidden = true;
    if (teamExtras) teamExtras.querySelectorAll<HTMLElement>('select,button').forEach((el) => { el.hidden = true; });
  }
  renderTeamSelect();
  nav?.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    if (button.dataset.toolPage === 'depth-chart') button.classList.toggle('active', on);
    else if (on) button.classList.remove('active');
  });
}

function renderTeamSelect(): void {
  if (!data || !active) { teamSelect.hidden = true; return; }
  const userTeams = data.teams.filter((team) => team.isUserControlled);
  const options = userTeams.length ? userTeams : data.teams;
  teamSelect.hidden = options.length <= 1;
  teamSelect.innerHTML = options.map((team) =>
    `<option value="${team.teamIndex}"${team.teamIndex === data!.teamIndex ? ' selected' : ''}>${esc(team.teamName)}</option>`).join('');
}

async function loadData(teamIndex?: number | null): Promise<void> {
  const filePath = await currentSavePath();
  if (!filePath) { data = null; loadedFrom = ''; render(); return; }
  busy = true;
  message = { tone: 'info', html: `Reading <strong>${esc(fileName(filePath))}</strong>…` };
  render();
  try {
    const remembered = Number(localStorage.getItem(TEAM_KEY));
    const requested = teamIndex ?? (Number.isFinite(remembered) && localStorage.getItem(TEAM_KEY) != null ? remembered : null);
    data = await api.load(filePath, requested);
    loadedFrom = filePath;
    localStorage.setItem(TEAM_KEY, String(data.teamIndex));
    include = new Set(data.plan.slots.filter((slot) => slot.changed).map((slot) => slot.key));
    message = null;
  } catch (error) {
    message = { tone: 'error', html: `<strong>Could not read the depth chart.</strong> ${esc(error instanceof Error ? error.message : String(error))}` };
  } finally {
    busy = false;
    renderTeamSelect();
    render();
  }
}

function playerLookup(load: DepthChartLoad) {
  const map = new Map<number, { name: string; position: string; ovr: number; archetype?: string; dev?: string; year?: string; jersey?: number; abilities?: string[] }>();
  for (const p of load.players) map.set(p.row, p);
  for (const p of load.others) map.set(p.row, p);
  return map;
}

function chip(load: DepthChartLoad, row: number, index: number, slot: DcSlotPlan, note?: string): string {
  const player = playerLookup(load).get(row);
  if (!player) return `<span class="dc-chip unknown"><b>${index + 1}</b>Unknown player</span>`;
  // In the recommended column a cross-position name is a deliberate pick (fill-in or
  // pass-rush import), so it gets the amber "borrowed" style instead of the red warning.
  const outOfPosition = !SLOT_POSITIONS[slot.key].includes(player.position);
  const positionClass = outOfPosition ? (note ? ' borrowed' : ' off-position') : '';
  const starter = index < slot.starters;
  const pos = DISPLAY[player.position] ?? player.position;
  const tip = [
    `${player.name} · ${pos} · ${player.ovr} OVR`,
    player.archetype ? prettyArchetype(player.archetype) : '',
    player.dev ? `${prettyDev(player.dev)} dev` : '',
    note ?? '',
  ].filter(Boolean).join('\n');
  return `<span class="dc-chip${starter ? ' starter' : ''}${positionClass}" title="${esc(tip)}"><b>${index + 1}</b><span class="dc-name">${esc(player.name)}</span><em>${esc(pos)} ${player.ovr}</em></span>`;
}

function slotRow(load: DepthChartLoad, slot: DcSlotPlan): string {
  const current = slot.current.map((row, index) => chip(load, row, index, slot)).join('');
  const next = slot.recommended.map((entry, index) => chip(load, entry.row, index, slot, entry.note)).join('');
  const lookup = playerLookup(load);
  const notes = slot.recommended.map((entry, index) => {
    const player = lookup.get(entry.row);
    return `<li><b>${index + 1}. ${esc(player?.name ?? 'Unknown')}</b> ${esc(entry.note)}</li>`;
  }).join('');
  const checked = include.has(slot.key);
  return `<tr class="${slot.changed ? 'changed' : 'unchanged'}">
    <td><div class="dc-slot"><strong>${esc(slot.label)}</strong><small>${esc(SLOT_HELP[slot.key])} · ${slot.size} spots</small></div></td>
    <td><div class="dc-chips">${current || '<span class="dc-empty">Empty</span>'}</div></td>
    <td><div class="dc-chips">${next}</div><details class="dc-why"><summary>Why</summary><ol>${notes}</ol></details></td>
    <td class="dc-include">${slot.changed
      ? `<label class="dc-check"><input type="checkbox" data-dc-include="${slot.key}"${checked ? ' checked' : ''}${busy ? ' disabled' : ''}><span>${checked ? 'Write' : 'Skip'}</span></label>`
      : '<span class="dc-same">No change</span>'}</td>
  </tr>`;
}

function offPositionCount(load: DepthChartLoad): number {
  const lookup = playerLookup(load);
  let count = 0;
  for (const slot of load.plan.slots) {
    for (const row of slot.current) {
      const player = lookup.get(row);
      if (player && !SLOT_POSITIONS[slot.key].includes(player.position)) count += 1;
    }
  }
  return count;
}

function render(): void {
  if (!active || !content || !pageTitle) return;
  pageTitle.textContent = 'Depth Chart';
  if (pageSubtitle) pageSubtitle.textContent = 'Position-locked defensive depth chart builder.';
  syncButton.disabled = busy || !loadedFrom;
  const banner = message ? `<div class="dc-message ${message.tone}">${message.html}</div>` : '';

  if (!data) {
    content.innerHTML = `<div class="depth-chart-view">${banner}
      <section class="dc-panel"><div class="dc-panel-head"><h2>Defensive Depth Chart</h2></div>
      <div class="dc-empty-state">${busy ? 'Reading save…' : 'Use <strong>Import Dynasty</strong> to load your save, then come back here.'}</div></section></div>`;
    return;
  }

  const base = data.plan.slots.filter((slot) => slot.kind === 'base');
  const packages = data.plan.slots.filter((slot) => slot.kind === 'package');
  const selected = data.plan.slots.filter((slot) => include.has(slot.key));
  const offPosition = offPositionCount(data);
  const table = (rows: DcSlotPlan[]) => `<div class="dc-table-wrap"><table class="dc-table"><thead><tr><th>Spot</th><th>Current</th><th>Recommended</th><th>Write</th></tr></thead><tbody>${rows.map((slot) => slotRow(data!, slot)).join('')}</tbody></table></div>`;

  content.innerHTML = `<div class="depth-chart-view">
    ${banner}
    <section class="dc-summary">
      <article><span>Team</span><strong>${esc(data.teamName)}</strong><small>${data.players.length} defenders</small></article>
      <article><span>Spots to change</span><strong>${data.plan.changedSlots} / ${data.plan.slots.length}</strong><small>Base + sub packages</small></article>
      <article><span>Out of position now</span><strong>${offPosition}</strong><small>Current entries at the wrong spot</small></article>
      <article><span>Writes to</span><strong>New copy</strong><small>Original save stays untouched</small></article>
    </section>
    <section class="dc-panel">
      <div class="dc-panel-head"><h2>Base Positions</h2><div class="dc-legend"><span class="dc-chip starter"><b>1</b>Starter</span><span class="dc-chip off-position"><b>1</b>Wrong position</span><span class="dc-chip borrowed"><b>1</b>Borrowed on purpose</span></div></div>
      ${table(base)}
    </section>
    <section class="dc-panel">
      <div class="dc-panel-head"><h2>Sub Packages</h2></div>
      ${table(packages)}
    </section>
    <section class="dc-actions">
      <div><strong>${selected.length} spot${selected.length === 1 ? '' : 's'} selected</strong><small>Read from ${esc(fileName(data.filePath))}. Writing saves a new versioned copy next to it (for example <code>${esc(fileName(data.filePath))}-DC-v1</code>).</small></div>
      <button id="dcWriteBtn" class="primary" type="button"${busy || !selected.length ? ' disabled' : ''}>${busy ? 'Working…' : 'Write to New Save Copy'}</button>
    </section>
    <p class="dc-footnote"><b>Rules:</b> every base spot uses only players listed at that position, so blowout subs never pull a starter to a different spot. Overall decides the order; when two players are within 1 point, the ratings that matter for that spot break the tie. A short position group borrows spare players from the same unit who are on no other list. Sub packages rank by pass rush (RLE, RRE, RDT), run fit (NT), MIKE order (SUBLB) and slot coverage (SLCB). Hover any player for details.</p>
  </div>`;
}

async function writeSelected(): Promise<void> {
  if (!data || busy) return;
  const slots = data.plan.slots.filter((slot) => include.has(slot.key));
  if (!slots.length) return;
  const request: DepthChartWriteRequest = {
    teamIndex: data.teamIndex,
    slots: slots.map((slot) => ({ key: slot.key, rows: slot.recommended.map((entry) => entry.row) })),
  };
  busy = true;
  message = { tone: 'info', html: 'Writing and verifying the new save copy…' };
  render();
  try {
    const result = await api.write(data.filePath, request);
    if (!result) {
      message = { tone: 'info', html: 'Write cancelled. Nothing was saved.' };
    } else {
      message = {
        tone: 'success',
        html: `<strong>Saved ${esc(fileName(result.outputPath))}.</strong> ${result.verifiedSlots} spots written and verified (${result.writtenEntries} players).${result.backupPath ? ` The file it replaced was backed up to ${esc(result.backupPath)}.` : ''} Load this copy in CFB 27 to use the new chart.`,
      };
    }
  } catch (error) {
    message = { tone: 'error', html: `<strong>Write failed.</strong> ${esc(error instanceof Error ? error.message : String(error)).replaceAll('\n', '<br>')}` };
  } finally {
    busy = false;
    render();
  }
}

installNav();

nav?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button) return;
  if (button.dataset.toolPage === 'depth-chart') {
    event.preventDefault();
    setShell(true);
    render();
    void (async () => {
      const filePath = await currentSavePath();
      if (filePath && filePath !== loadedFrom) await loadData();
      else render();
    })();
    return;
  }
  if (active) setShell(false);
}, true);

syncButton.addEventListener('click', () => { if (!busy) void loadData(data?.teamIndex ?? null); });

teamSelect.addEventListener('change', () => {
  const index = Number(teamSelect.value);
  if (Number.isFinite(index)) {
    localStorage.setItem(TEAM_KEY, String(index));
    void loadData(index);
  }
});

content?.addEventListener('change', (event) => {
  if (!active) return;
  const box = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-dc-include]');
  if (!box) return;
  const key = box.dataset.dcInclude as SlotKey;
  if (box.checked) include.add(key); else include.delete(key);
  render();
});

content?.addEventListener('click', (event) => {
  if (!active) return;
  if ((event.target as HTMLElement).closest('#dcWriteBtn')) void writeSelected();
});

// Import Dynasty reuses the Offseason importer, which re-renders #content.
// When the import was started from this page, come back and read the new save.
globalImport?.addEventListener('click', () => {
  if (!active) return;
  const started = Date.now();
  let sawBusy = false;
  const timer = window.setInterval(() => {
    if (globalImport.disabled) sawBusy = true;
    if ((sawBusy && !globalImport.disabled) || Date.now() - started > 60000) {
      window.clearInterval(timer);
      setShell(true);
      void loadData(null);
    }
  }, 60);
});

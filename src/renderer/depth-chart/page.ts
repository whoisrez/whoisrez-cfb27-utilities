// Depth Chart: position-locked depth chart builder for defense, offense and special teams.
import type { DcPlayerView, DcSide, DcSlotPlan, DepthChartLoad } from '../../shared/depth-chart';
import { DISPLAY_POSITION } from '../../shared/depth-chart';
import { esc, plural, saveFileName } from '../html';

export const DEPTH_CHART_TITLE = 'Depth Chart';
export const DEPTH_CHART_SUBTITLE = 'Position-locked depth chart builder.';

export const SIDES: Array<{ id: DcSide; label: string }> = [
  { id: 'offense', label: 'Offense' },
  { id: 'defense', label: 'Defense' },
  { id: 'special', label: 'Special Teams' },
];

const COMMON_RULES = 'Your current chart wins ties: a spot only changes when the player there now is out of position, starts somewhere else, or the new pick is clearly better (more than 1 overall, or clearly better ratings for that spot). Injured players keep their spot and the next healthy player plays until they are back.';

export type DepthChartView = {
  data: DepthChartLoad | null;
  side: DcSide;
  include: Set<string>;
  busy: boolean;
  /** Result / progress banner shown above the chart. */
  message: { tone: 'info' | 'success' | 'error'; html: string } | null;
};

const RULES: Record<DcSide, string> = {
  defense: 'Every base spot uses only players listed at that position, so blowout subs never pull a starter to another spot. Overall sets the order; within 1 point, the ratings that matter for that spot break the tie. A short group borrows a spare from the same unit who is on no other list. RLE/RRE/RDT rank by pass rush, NT by run fit, SUBLB follows the MIKE order, and SLCB ranks the non-starting corners by slot coverage. A backup SAM/WILL can lead RLE/RRE only if he out-rushes every end on that side.',
  offense: 'Same position lock as defense: QBs at QB, guards at their own guard spot, and so on. Overall sets the order; within 1 point, the ratings for that spot break the tie. A short group borrows a spare from the same unit first (backs, receivers, line), then any unlisted skill player or lineman. 3DRB ranks halfbacks by receiving and pass blocking, PWHB by power running, SLWR ranks the non-starting receivers by slot skills, and GAD ranks receivers by open-field ability.',
  special: 'Kickers and punters back each other up, because specialists never come in as blowout subs. KOS ranks by kick power. Returners and the long snapper come from non-starters first, so no starter is exposed on special teams. Return spots rank by return ability, speed and ball security; the long snapper is the best Long Snap rating among non-starters.',
};

const sideOf = (data: DepthChartLoad, side: DcSide) => data.plan.slots.filter((slot) => slot.side === side);

function prettyArchetype(value: string): string {
  return value.replace(/^[A-Z]+_/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Indexes that are on the field: the first `starters` healthy players (an injured starter's backup plays). */
function playingIndexes(rows: number[], players: Map<number, DcPlayerView>, starters: number): Set<number> {
  const playing = new Set<number>();
  rows.forEach((row, index) => {
    if (playing.size < starters && !players.get(row)?.injury) playing.add(index);
  });
  return playing;
}

function chip(player: DcPlayerView | undefined, index: number, slot: DcSlotPlan, playing: Set<number>, note?: string): string {
  if (!player) return `<span class="dc-chip"><b>${index + 1}</b>Unknown player</span>`;
  const outOfPosition = slot.positions.length > 0 && !slot.positions.includes(player.position);
  // In the recommended column a cross-position pick is deliberate (fill-in, import, specialist backup).
  const positionClass = outOfPosition ? (note ? ' borrowed' : ' off-position') : '';
  const starter = playing.has(index) ? ' starter' : '';
  const injured = player.injury ? ' injured' : '';
  const position = DISPLAY_POSITION[player.position] ?? player.position;
  const tip = [`${player.name} · ${position} · ${player.ovr} OVR`, prettyArchetype(player.archetype), player.dev ? `${player.dev.replace(/^College_/, '')} dev` : '', note ?? '']
    .filter(Boolean).join('\n');
  const outTag = player.injury ? '<i class="dc-out">OUT</i>' : '';
  return `<span class="dc-chip${starter}${positionClass}${injured}" title="${esc(tip)}"><b>${index + 1}</b><span class="dc-name">${esc(player.name)}</span><em>${esc(position)} ${player.ovr}</em>${outTag}</span>`;
}

function slotRow(view: DepthChartView, players: Map<number, DcPlayerView>, slot: DcSlotPlan): string {
  const nowPlaying = playingIndexes(slot.current, players, slot.starters);
  const nextPlaying = playingIndexes(slot.recommended.map((entry) => entry.row), players, slot.starters);
  const current = slot.current.map((row, index) => chip(players.get(row), index, slot, nowPlaying)).join('');
  const next = slot.recommended.map((entry, index) => chip(players.get(entry.row), index, slot, nextPlaying, entry.note)).join('');
  const notes = slot.recommended.map((entry, index) => {
    const versus = entry.versus ? `<span class="dc-versus">${esc(entry.versus)}</span>` : '';
    return `<li${entry.versus ? ' class="dc-changed-spot"' : ''}><b>${index + 1}. ${esc(players.get(entry.row)?.name ?? 'Unknown')}</b> ${esc(entry.note)}${versus}</li>`;
  }).join('');
  const checked = view.include.has(slot.key);
  const write = slot.changed
    ? `<label class="dc-check"><input type="checkbox" data-dc-include="${esc(slot.key)}"${checked ? ' checked' : ''}${view.busy ? ' disabled' : ''}><span>${checked ? 'Write' : 'Skip'}</span></label>`
    : '<span class="dc-same">No change</span>';
  return `<tr class="${slot.changed ? 'changed' : 'unchanged'}">
    <td><div class="dc-slot"><strong>${esc(slot.label)}</strong><small>${esc(slot.help)} · ${slot.size} spot${plural(slot.size)}</small></div></td>
    <td><div class="dc-chips">${current || '<span class="dc-empty">Empty</span>'}</div></td>
    <td><div class="dc-chips">${next}</div><details class="dc-why"${slot.changed ? ' open' : ''}><summary>${slot.changed ? 'Why, and why it beats your current chart' : 'Why'}</summary><ol>${notes}</ol></details></td>
    <td class="dc-include">${write}</td>
  </tr>`;
}

function table(view: DepthChartView, players: Map<number, DcPlayerView>, title: string, slots: DcSlotPlan[], legend: boolean): string {
  if (!slots.length) return '';
  const legendHtml = legend
    ? '<div class="dc-legend"><span class="dc-chip starter"><b>1</b>Plays</span><span class="dc-chip off-position"><b>1</b>Wrong position</span><span class="dc-chip borrowed"><b>1</b>Borrowed on purpose</span><span class="dc-chip injured"><b>1</b>Injured<i class="dc-out">OUT</i></span></div>'
    : '';
  return `<section class="dc-panel">
    <div class="dc-panel-head"><h2>${esc(title)}</h2>${legendHtml}</div>
    <div class="dc-table-wrap"><table class="dc-table"><thead><tr><th>Spot</th><th>Current</th><th>Recommended</th><th>Write</th></tr></thead>
    <tbody>${slots.map((slot) => slotRow(view, players, slot)).join('')}</tbody></table></div>
  </section>`;
}

function offPositionCount(slots: DcSlotPlan[], players: Map<number, DcPlayerView>): number {
  let count = 0;
  for (const slot of slots) {
    if (!slot.positions.length || slot.side === 'special') continue;
    for (const row of slot.current) {
      const player = players.get(row);
      if (player && !slot.positions.includes(player.position)) count += 1;
    }
  }
  return count;
}

export function renderDepthChart(view: DepthChartView): [status: string, content: string] {
  const banner = view.message ? `<div class="dc-message ${view.message.tone}">${view.message.html}</div>` : '';
  const { data } = view;
  if (!data) {
    const status = '<span><strong>No dynasty loaded.</strong> Use Import Dynasty to choose your save.</span><span>Writes always go to a new copy.</span>';
    const content = `<div class="depth-chart-view">${banner}<section class="dc-panel"><div class="dc-panel-head"><h2>Depth Chart</h2></div>
      <div class="dc-empty-state">${view.busy ? 'Reading save…' : 'Import a CFB 27 dynasty save to build the depth chart.'}</div></section></div>`;
    return [status, content];
  }

  const players = new Map(data.players.map((player) => [player.row, player]));
  const slots = sideOf(data, view.side);
  const changed = slots.filter((slot) => slot.changed).length;
  const selectedAll = data.plan.slots.filter((slot) => view.include.has(slot.key));
  const tabs = SIDES.map((side) => {
    const sideSlots = sideOf(data, side.id);
    const count = sideSlots.filter((slot) => view.include.has(slot.key)).length;
    return `<button type="button" class="dc-tab${side.id === view.side ? ' active' : ''}" data-dc-side="${side.id}">${side.label}<span>${count} / ${sideSlots.length}</span></button>`;
  }).join('');
  const sideLabel = SIDES.find((side) => side.id === view.side)!.label;
  const allSelected = slots.filter((slot) => slot.changed).every((slot) => view.include.has(slot.key));

  const injured = data.players.filter((player) => player.injury).length;
  const status = `<span><strong>${esc(data.teamName)} loaded.</strong> ${data.players.length} players read from ${esc(saveFileName(data.filePath))}${injured ? ` · ${injured} injured (they keep their spots; the next healthy player plays)` : ''}.</span><span>Writes go to a new copy · original save untouched</span>`;
  const content = `<div class="depth-chart-view">
    ${banner}
    <nav class="dc-tabs" aria-label="Depth chart side">${tabs}</nav>
    <section class="dc-summary">
      <article><span>Team</span><strong>${esc(data.teamName)}</strong><small>${data.players.length} players</small></article>
      <article><span>${esc(sideLabel)} spots to change</span><strong>${changed} / ${slots.length}</strong><small>Base + packages</small></article>
      <article><span>Out of position now</span><strong>${view.side === 'special' ? '—' : offPositionCount(slots, players)}</strong><small>${view.side === 'special' ? 'Specialists can share' : 'Current entries at the wrong spot'}</small></article>
      <article><span>Selected to write</span><strong>${selectedAll.length}</strong><small>Across all three tabs</small></article>
    </section>
    ${table(view, players, view.side === 'special' ? 'Special Teams' : 'Base Positions', slots.filter((slot) => slot.kind === 'base' || view.side === 'special'), true)}
    ${view.side === 'special' ? '' : table(view, players, 'Packages', slots.filter((slot) => slot.kind === 'package'), false)}
    <section class="dc-actions">
      <div><strong>${selectedAll.length} list${plural(selectedAll.length)} selected</strong><small>Saves a new versioned copy next to ${esc(saveFileName(data.filePath))} (for example <code>${esc(saveFileName(data.filePath))}-DC-v1</code>) and re-reads it to check every spot.</small></div>
      <div class="dc-action-buttons">
        ${changed ? `<button type="button" class="secondary" data-dc-toggle-side="${view.side}"${view.busy ? ' disabled' : ''}>${allSelected ? 'Skip' : 'Select'} all ${esc(sideLabel)}</button>` : ''}
        <button id="dcWriteBtn" class="primary" type="button"${view.busy || !selectedAll.length ? ' disabled' : ''}>${view.busy ? 'Working…' : 'Write to New Save Copy'}</button>
      </div>
    </section>
    <p class="dc-rules"><b>How ${esc(sideLabel.toLowerCase())} is built:</b> ${esc(RULES[view.side])} ${esc(COMMON_RULES)} Hover a player or open “Why” for the reason behind each spot.</p>
  </div>`;
  return [status, content];
}

/** Changed lists start selected; unchanged ones have nothing to write. */
export function defaultInclude(data: DepthChartLoad): Set<string> {
  return new Set(data.plan.slots.filter((slot) => slot.changed).map((slot) => slot.key));
}

export function depthChartTeamOptions(data: DepthChartLoad | null): string {
  if (!data) return '';
  const userTeams = data.teams.filter((team) => team.isUserControlled);
  return (userTeams.length ? userTeams : data.teams)
    .map((team) => `<option value="${team.teamIndex}"${team.teamIndex === data.teamIndex ? ' selected' : ''}>${esc(team.teamName)}</option>`)
    .join('');
}

export function depthChartTeamCount(data: DepthChartLoad | null): number {
  if (!data) return 0;
  const userTeams = data.teams.filter((team) => team.isUserControlled);
  return userTeams.length || data.teams.length;
}

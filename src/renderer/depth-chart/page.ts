// Depth Chart: position-locked depth chart builder for offense, defense and special teams,
// with an editable logic panel (scheme, starters, rule switches, rating weights).
import type { DcPlan, DcPlayerView, DcSide, DcSlotPlan, DepthChartLoad } from '../../shared/depth-chart';
import { DISPLAY_POSITION } from '../../shared/depth-chart';
import {
  DEFAULT_WEIGHTS, DEFENSE_SCHEMES, PRESETS, RATING_LABELS, SCORE_GROUPS, SCORE_LABELS, schemeFor, startersFor, weightsFor,
  type DcSettings, type ScoreKey,
} from '../../shared/depth-chart-settings';
import { esc, plural, saveFileName } from '../html';

export const DEPTH_CHART_TITLE = 'Depth Chart';
export const DEPTH_CHART_SUBTITLE = 'Position-locked depth chart builder.';

export const SIDES: Array<{ id: DcSide; label: string }> = [
  { id: 'offense', label: 'Offense' },
  { id: 'defense', label: 'Defense' },
  { id: 'special', label: 'Special Teams' },
];

export type DepthChartView = {
  data: DepthChartLoad | null;
  plan: DcPlan | null;
  settings: DcSettings;
  side: DcSide;
  include: Set<string>;
  busy: boolean;
  showSettings: boolean;
  formula: ScoreKey;
  pasteOpen: boolean;
  /** Result / progress banner shown above the chart. */
  message: { tone: 'info' | 'success' | 'error'; html: string } | null;
};

const SIDE_RULES: Record<DcSide, string> = {
  offense: 'Every base spot uses only players listed at that position (guards stay on their own side, and so on). A short group borrows a spare from the same unit first (backs, receivers, line), then any unlisted skill player or lineman. 3DRB, PWHB, SLWR and GAD each rank their group by their own formula; SLWR skips the starting outside receivers.',
  defense: 'Every base spot uses only players listed at that position, so blowout subs never pull a starter to another spot. A short group borrows a spare from the same unit who is on no other list. RLE/RRE/RDT rank by pass rush, NT by run fit, SUBLB follows the MIKE order, and SLCB ranks the corners who are not starting outside. A backup SAM/WILL can lead RLE/RRE if he out-rushes every end on that side.',
  special: 'Kickers and punters back each other up, because specialists never come in as blowout subs. KOS ranks by kickoff formula. Returners and the long snapper come from non-starters first.',
};

const PLAYING_KEYS_BY_SIDE: Record<DcSide, string[]> = {
  offense: ['QB', 'HB', 'FB', 'WR', 'TE', 'SLWR'],
  defense: ['LE', 'RE', 'DT', 'LOLB', 'MLB', 'ROLB', 'CB', 'FS', 'SS', 'SLCB'],
  special: [],
};

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
    return `<li><b>${index + 1}. ${esc(players.get(entry.row)?.name ?? 'Unknown')}</b> ${esc(entry.note)}${versus}</li>`;
  }).join('');
  const checked = view.include.has(slot.key);
  const write = slot.changed
    ? `<label class="dc-check"><input type="checkbox" data-dc-include="${esc(slot.key)}"${checked ? ' checked' : ''}${view.busy ? ' disabled' : ''}><span>${checked ? 'Write' : 'Skip'}</span></label>`
    : '<span class="dc-same">No change</span>';
  const startersText = slot.starters ? ` · ${slot.starters} start${slot.starters === 1 ? 's' : ''}` : '';
  return `<tr class="${slot.changed ? 'changed' : 'unchanged'}">
    <td><div class="dc-slot"><strong>${esc(slot.label)}</strong><small>${esc(slot.help)} · ${slot.size} spot${plural(slot.size)}${startersText}</small></div></td>
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
    slot.current.forEach((row, index) => {
      const player = players.get(row);
      // Deliberate cross-position picks the rules keep (fill-ins, pass-rush imports) are not mistakes.
      if (player && !slot.positions.includes(player.position) && slot.recommended[index]?.row !== row) count += 1;
    });
  }
  return count;
}

// ---- Customize panel ---------------------------------------------------------------------------

function numberInput(attr: string, value: number, min: number, max: number, step = 1): string {
  return `<input type="number" ${attr} value="${esc(value)}" min="${min}" max="${max}" step="${step}">`;
}

function toggle(setting: keyof DcSettings, label: string, hint: string, settings: DcSettings): string {
  return `<label class="dc-toggle"><input type="checkbox" data-dc-setting="${setting}"${settings[setting] ? ' checked' : ''}><span><b>${esc(label)}</b><small>${esc(hint)}</small></span></label>`;
}

function settingsPanel(view: DepthChartView): string {
  const { settings, data } = view;
  const saved = data?.defenseScheme ?? '';
  const savedLabel = DEFENSE_SCHEMES.find((scheme) => scheme.id === saved)?.label ?? 'not set';
  const scheme = schemeFor(settings, saved);
  const schemeOptions = [`<option value="auto"${settings.defenseScheme === 'auto' ? ' selected' : ''}>Use the save's scheme (${esc(savedLabel)})</option>`,
    ...DEFENSE_SCHEMES.map((item) => `<option value="${item.id}"${settings.defenseScheme === item.id ? ' selected' : ''}>${esc(item.label)}</option>`)].join('');

  const starterKeys: Array<[string, string]> = [
    ['QB', 'QB'], ['HB', 'HB'], ['FB', 'FB'], ['WR', 'WR (outside)'], ['SLWR', 'SLWR'], ['TE', 'TE'],
    ['LE', 'LEDG'], ['RE', 'REDG'], ['DT', 'DT'], ['LOLB', 'SAM'], ['MLB', 'MIKE'], ['ROLB', 'WILL'], ['CB', 'CB (outside)'], ['SLCB', 'SLCB'], ['FS', 'FS'], ['SS', 'SS'],
  ];
  const starters = starterKeys.map(([key, label]) => {
    const overridden = Number.isFinite(settings.starters[key]);
    return `<label class="dc-starter${overridden ? ' overridden' : ''}"><span>${esc(label)}</span>${numberInput(`data-dc-starter="${key}"`, startersFor(settings, scheme, key), 0, 6)}</label>`;
  }).join('');

  const formula = view.formula;
  const weights = weightsFor(settings, formula);
  const customized = Boolean(settings.weights[formula]);
  const formulaOptions = SCORE_GROUPS.map((group) => `<optgroup label="${esc(group.label)}">${group.keys.map((key) =>
    `<option value="${key}"${key === formula ? ' selected' : ''}>${esc(SCORE_LABELS[key])}${settings.weights[key] ? ' • edited' : ''}</option>`).join('')}</optgroup>`).join('');
  const total = Object.values(weights).reduce((sum, weight) => sum + (weight > 0 ? weight : 0), 0);
  const ratingKeys = Object.keys(RATING_LABELS);
  const used = ratingKeys.filter((key) => (weights[key] ?? 0) > 0).sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0));
  const unused = ratingKeys.filter((key) => !((weights[key] ?? 0) > 0));
  const weightCell = (key: string) => {
    const weight = weights[key] ?? 0;
    const share = total && weight > 0 ? `${Math.round((weight / total) * 100)}%` : '';
    return `<label class="dc-weight${weight > 0 ? ' on' : ''}"><span>${esc(RATING_LABELS[key])}</span>${numberInput(`data-dc-weight="${key}"`, weight, 0, 100)}<em>${share}</em></label>`;
  };

  const presets = PRESETS.map((preset) => `<button type="button" class="secondary" data-dc-action="preset:${preset.id}">${esc(preset.label)}</button>`).join('');
  const paste = view.pasteOpen
    ? `<div class="dc-paste"><textarea id="dcPasteBox" placeholder="Paste settings copied from CFB 27 Utilities"></textarea><button type="button" class="primary" data-dc-action="paste-apply">Apply pasted settings</button></div>`
    : '';

  return `<section class="dc-panel dc-settings">
    <div class="dc-panel-head"><h2>Customize the logic</h2>
      <div class="dc-settings-actions">
        <button type="button" class="secondary" data-dc-action="copy">Copy settings</button>
        <button type="button" class="secondary" data-dc-action="paste-toggle">${view.pasteOpen ? 'Cancel paste' : 'Paste settings'}</button>
        <button type="button" class="secondary" data-dc-action="reset-all">Reset everything</button>
      </div>
    </div>
    ${paste}
    <div class="dc-settings-grid">
      <div class="dc-settings-block">
        <h3>Scheme and order</h3>
        <label class="dc-field"><span>Defensive scheme</span><select data-dc-setting="defenseScheme">${schemeOptions}</select><small>Sets how many players start at each defensive spot (who is protected from blowout subs and who counts as a starter).</small></label>
        <label class="dc-field"><span>Order players by</span><select data-dc-setting="orderBy">
          <option value="overall"${settings.orderBy === 'overall' ? ' selected' : ''}>Overall first, ratings break ties</option>
          <option value="ratings"${settings.orderBy === 'ratings' ? ' selected' : ''}>Weighted ratings only</option>
        </select></label>
        <label class="dc-field inline"><span>Tie window (overall points)</span>${numberInput('data-dc-setting="tieWindow"', settings.tieWindow, 0, 10)}</label>
      </div>
      <div class="dc-settings-block">
        <h3>Rules</h3>
        ${toggle('keepCurrent', 'Keep my current chart when it is close', 'Only replace a player when the pick is clearly better.', settings)}
        <label class="dc-field inline"><span>“Clearly better” margin (rating points)</span>${numberInput('data-dc-setting="keepMargin"', settings.keepMargin, 0, 20, 0.5)}</label>
        ${toggle('borrowWhenShort', 'Borrow when a group is short', 'Fill extra spots with players on no other list.', settings)}
        ${toggle('edgeImports', 'Backup SAM/WILL can lead RLE/RRE', 'Only when he out-rushes every end on that side.', settings)}
        ${toggle('protectStartersOnSpecialTeams', 'Keep starters off returns and long snap', 'Use non-starters first.', settings)}
        ${toggle('injuredKeepSpot', 'Injured players keep their spot', 'Off: injured players drop to the bottom of their list.', settings)}
        <label class="dc-field inline"><span>Slot-archetype bonus for SLCB</span>${numberInput('data-dc-setting="slotArchetypeBonus"', settings.slotArchetypeBonus, 0, 20)}</label>
      </div>
      <div class="dc-settings-block wide">
        <h3>Starters per spot <button type="button" class="dc-link" data-dc-action="reset-starters">Use scheme defaults</button></h3>
        <div class="dc-starters">${starters}</div>
        <small class="dc-hint">Edited numbers are outlined. Starters are who the game puts on the field first; they are kept off other lists, returns and long snap.</small>
      </div>
      <div class="dc-settings-block wide">
        <h3>Rating weights</h3>
        <div class="dc-formula-bar">
          <label class="dc-field inline"><span>Formula</span><select data-dc-formula>${formulaOptions}</select></label>
          ${customized ? '<button type="button" class="dc-link" data-dc-action="reset-formula">Reset this formula</button>' : '<span class="dc-hint">Default weights</span>'}
          <span class="dc-preset-label">Lean every formula toward:</span>${presets}
        </div>
        <div class="dc-weights">${used.map(weightCell).join('')}</div>
        <details class="dc-more-ratings"><summary>Add another rating (${unused.length})</summary><div class="dc-weights">${unused.map(weightCell).join('')}</div></details>
        <small class="dc-hint">Weights are relative: each formula is a weighted average of the ratings above, shown as a share of the total. ${Object.keys(DEFAULT_WEIGHTS).length} formulas cover every spot and package.</small>
      </div>
    </div>
  </section>`;
}

// ---- Page -----------------------------------------------------------------------------------------

export function renderDepthChart(view: DepthChartView): [status: string, content: string] {
  const banner = view.message ? `<div class="dc-message ${view.message.tone}">${view.message.html}</div>` : '';
  const { data, plan } = view;
  if (!data || !plan) {
    const status = '<span><strong>No dynasty loaded.</strong> Use Import Dynasty to choose your save.</span><span>Writes always go to a new copy.</span>';
    const content = `<div class="depth-chart-view">${banner}<section class="dc-panel"><div class="dc-panel-head"><h2>Depth Chart</h2></div>
      <div class="dc-empty-state">${view.busy ? 'Reading save…' : 'Import a CFB 27 dynasty save to build the depth chart.'}</div></section></div>`;
    return [status, content];
  }

  const players = new Map(data.players.map((player) => [player.row, player]));
  const slots = plan.slots.filter((slot) => slot.side === view.side);
  const changed = slots.filter((slot) => slot.changed).length;
  const selectedAll = plan.slots.filter((slot) => view.include.has(slot.key));
  const tabs = SIDES.map((side) => {
    const sideSlots = plan.slots.filter((slot) => slot.side === side.id);
    const count = sideSlots.filter((slot) => view.include.has(slot.key)).length;
    return `<button type="button" class="dc-tab${side.id === view.side ? ' active' : ''}" data-dc-side="${side.id}">${side.label}<span>${count} / ${sideSlots.length}</span></button>`;
  }).join('');
  const sideLabel = SIDES.find((side) => side.id === view.side)!.label;
  const allSelected = slots.filter((slot) => slot.changed).every((slot) => view.include.has(slot.key));
  const injured = data.players.filter((player) => player.injury).length;
  const edited = Object.keys(view.settings.weights).length + Object.keys(view.settings.starters).length;
  const playingKeys = PLAYING_KEYS_BY_SIDE[view.side];

  const status = `<span><strong>${esc(data.teamName)} loaded.</strong> ${data.players.length} players read from ${esc(saveFileName(data.filePath))}${injured ? ` · ${injured} injured (they keep their spots; the next healthy player plays)` : ''}.</span><span>Writes go to a new copy · original save untouched</span>`;
  const content = `<div class="depth-chart-view">
    ${banner}
    <div class="dc-toolbar">
      <nav class="dc-tabs" aria-label="Depth chart side">${tabs}</nav>
      <button type="button" class="secondary dc-customize${view.showSettings ? ' active' : ''}" data-dc-action="toggle-settings">${view.showSettings ? 'Hide logic' : 'Customize logic'}${edited ? ` <span>${edited} edited</span>` : ''}</button>
    </div>
    ${view.showSettings ? settingsPanel(view) : ''}
    <section class="dc-summary">
      <article><span>Team · scheme</span><strong>${esc(data.teamName)}</strong><small>${esc(plan.schemeLabel)}${view.settings.defenseScheme === 'auto' ? ' (from save)' : ' (picked)'} · ${data.players.length} players</small></article>
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
    <p class="dc-rules"><b>How ${esc(sideLabel.toLowerCase())} is built:</b> ${esc(SIDE_RULES[view.side])} ${esc(commonRules(view.settings))}${playingKeys.length ? ' Starters per spot follow the scheme and can be changed in Customize logic.' : ''} Hover a player or open “Why” for the reason behind each spot.</p>
  </div>`;
  return [status, content];
}

function commonRules(settings: DcSettings): string {
  const order = settings.orderBy === 'overall'
    ? `Overall sets the order; within ${settings.tieWindow} point${settings.tieWindow === 1 ? '' : 's'}, the spot's weighted ratings break the tie.`
    : 'The spot\'s weighted ratings alone set the order.';
  const keep = settings.keepCurrent
    ? `Your current chart wins ties: a spot only changes when the player there is out of position, starts somewhere else, or the pick is clearly better (by more than ${settings.keepMargin} rating points${settings.orderBy === 'overall' ? `, or more than ${settings.tieWindow} overall` : ''}).`
    : 'Your current chart is not used as a tiebreaker.';
  const injury = settings.injuredKeepSpot ? 'Injured players keep their spot and the next healthy player plays.' : 'Injured players drop to the bottom of their list.';
  return `${order} ${keep} ${injury}`;
}

/** Changed lists start selected; unchanged ones have nothing to write. */
export function defaultInclude(plan: DcPlan): Set<string> {
  return new Set(plan.slots.filter((slot) => slot.changed).map((slot) => slot.key));
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

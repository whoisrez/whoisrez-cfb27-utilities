// Team Needs: 85-man roster plan for the user's school.
import { ROSTER_TARGETS, ROSTER_TARGET_TOTAL } from '../../shared/roster-targets';
import { availableTeamNeedsDepartures, calculateTeamNeedsStillNeeded, normalizeTeamNeedsDepartures } from '../../shared/team-needs-math';
import type { TeamNeedsDynasty, TeamNeedsPlayer, TeamNeedsTeam } from '../../shared/types';
import { esc, saveFileName } from '../html';
import { manualValues, rememberedTeamIndex, rememberTeamIndex } from './storage';

export const TEAM_NEEDS_TITLE = 'Team Needs';
export const TEAM_NEEDS_SUBTITLE = 'Weekly roster planning and committed-recruit tracking.';

const SECTIONS = [
  { id: 'offense', label: 'Offense', startKey: 'QB' },
  { id: 'defense', label: 'Defense', startKey: 'EDGE' },
  { id: 'special-teams', label: 'Special Teams', startKey: 'K' },
] as const;

// Save-file position codes → roster planner positions.
const POSITION_ALIASES: Record<string, string> = {
  RB: 'HB', LEDG: 'LE', LDE: 'LE', REDG: 'RE', RDE: 'RE', NT: 'DT',
  LOLB: 'SAM', MLB: 'MIKE', ROLB: 'WILL',
};

const displayPosition = (position: string) => POSITION_ALIASES[position] ?? position;
const isGraduatingSenior = (player: TeamNeedsPlayer) => player.schoolYear === 'Senior' && player.redshirtStatus !== 'Current';

/** User-controlled teams, or every team if the save marks none. */
export function selectableTeams(dynasty: TeamNeedsDynasty | null): TeamNeedsTeam[] {
  if (!dynasty) return [];
  const userTeams = dynasty.teams.filter((team) => team.isUserControlled);
  return userTeams.length ? userTeams : dynasty.teams;
}

/** Keep the current team on Sync; otherwise use the last-used team, then the first. */
export function chooseTeam(dynasty: TeamNeedsDynasty, current: number | null): number | null {
  const available = selectableTeams(dynasty);
  let selected: number | null;
  if (available.length === 1) selected = available[0].teamIndex;
  else if (current != null && available.some((team) => team.teamIndex === current)) selected = current;
  else selected = available.find((team) => team.teamIndex === rememberedTeamIndex())?.teamIndex ?? available[0]?.teamIndex ?? null;
  if (selected != null) rememberTeamIndex(selected);
  return selected;
}

export function teamOptions(dynasty: TeamNeedsDynasty | null, selected: number | null): string {
  return selectableTeams(dynasty).map((team) =>
    `<option value="${team.teamIndex}"${team.teamIndex === selected ? ' selected' : ''}>${esc(team.teamName)}${team.isUserControlled ? ' • User' : ''}</option>`,
  ).join('');
}

const EMPTY_STATUS = '<span><strong>No dynasty loaded.</strong> Use Import Dynasty to choose the save used by both sections.</span><span>Team Needs Sync is independent from Season Sync.</span>';

const EMPTY_VIEW = `<div class="team-needs-view">
      <section class="tn-summary">
        <article><span>Roster</span><strong>— / ${ROSTER_TARGET_TOTAL}</strong><small>Import dynasty</small></article>
        <article><span>Graduating</span><strong>—</strong><small>Projected departures</small></article>
        <article><span>Projected Returning</span><strong>—</strong><small>After departures</small></article>
        <article><span>Still Needed</span><strong>—</strong><small>Net to target</small></article>
      </section>
      <section class="tn-panel"><div class="tn-panel-head"><div><span class="eyebrow">85-MAN ROSTER PLAN</span><h2>Team Needs</h2></div></div><div class="tn-empty">Import a CFB 27 dynasty save to populate the chart.</div></section>
    </div>`;

function sectionDivider(groupKey: string): string {
  const section = SECTIONS.find((item) => item.startKey === groupKey);
  return section ? `<tr class="roster-section-divider" data-section="${section.id}"><td colspan="9">${section.label}</td></tr>` : '';
}

function planRows(team: TeamNeedsTeam) {
  return ROSTER_TARGETS.map((group) => {
    const players = team.roster.filter((player) => group.positions.includes(displayPosition(player.position)));
    const graduating = players.filter(isGraduatingSenior).length;
    const manual = manualValues(team.teamIndex, group.key);
    const departures = normalizeTeamNeedsDepartures(players.length, graduating, manual.transferring, manual.projectedDraft, manual.beingCut);
    const recruited = team.recruitingAuto
      ? team.recruits.filter((recruit) => group.positions.includes(displayPosition(recruit.position))).length
      : manual.recruited;
    const stillNeeded = calculateTeamNeedsStillNeeded(group.target, players.length, graduating, departures.transferring, departures.projectedDraft, departures.beingCut, recruited);
    return { group, onTeam: players.length, graduating, ...departures, recruited, available: availableTeamNeedsDepartures(players.length, graduating), stillNeeded };
  });
}

/** Returns [status, content] for the Team Needs page. */
export function renderTeamNeeds(dynasty: TeamNeedsDynasty | null, team: TeamNeedsTeam | null, needsOnly: boolean): [string, string] {
  if (!dynasty) return [EMPTY_STATUS, EMPTY_VIEW];
  if (!team) {
    return [
      `<span><strong>Dynasty loaded.</strong> ${dynasty.teams.length} team rosters found.</span><span>Select your school.</span>`,
      '<div class="team-needs-view"><section class="tn-panel"><div class="tn-empty">Select your school above to populate the chart.</div></section></div>',
    ];
  }

  const values = planRows(team);
  const sum = (pick: (row: (typeof values)[number]) => number) => values.reduce((total, row) => total + pick(row), 0);
  const totals = {
    graduating: sum((row) => row.graduating),
    transferring: sum((row) => row.transferring),
    projectedDraft: sum((row) => row.projectedDraft),
    beingCut: sum((row) => row.beingCut),
    recruited: sum((row) => row.recruited),
    stillNeeded: sum((row) => row.stillNeeded),
  };
  const projectedReturning = team.roster.length - totals.graduating - totals.transferring - totals.projectedDraft - totals.beingCut;

  const status = `<span><strong>${esc(team.teamName)} loaded.</strong> ${team.roster.length} players read from ${esc(saveFileName(dynasty.filePath))}.</span><span>${team.recruitingAuto ? `${totals.recruited} committed recruits auto-read.` : 'Recruited remains manual for this save.'}</span>`;

  const rows = values.map((row) => {
    const hidden = needsOnly && row.stillNeeded <= 0 ? 'needs-filter-hidden' : '';
    const needClass = row.stillNeeded > 0 ? 'need-positive' : row.stillNeeded < 0 ? 'need-surplus' : 'need-balanced';
    const statusText = row.stillNeeded > 0 ? `${row.stillNeeded} to add` : row.stillNeeded < 0 ? `${Math.abs(row.stillNeeded)} over target` : 'On target';
    // Transferring + Projected Draft + Being Cut can never exceed the non-graduating players.
    const maxTransferring = Math.max(0, row.available - row.projectedDraft - row.beingCut);
    const maxProjectedDraft = Math.max(0, row.available - row.transferring - row.beingCut);
    const maxBeingCut = Math.max(0, row.available - row.transferring - row.projectedDraft);
    const recruitedInput = `<div class="manual-wrap"><input class="tn-manual" type="number" min="0" max="85" step="1" data-manual-field="recruited" value="${row.recruited}"${team.recruitingAuto ? ' readonly' : ''}>${team.recruitingAuto ? '<small>auto</small>' : ''}</div>`;
    return `${sectionDivider(row.group.key)}<tr class="${hidden}" data-target-group="${esc(row.group.key)}" data-on-team="${row.onTeam}" data-graduating="${row.graduating}" data-target="${row.group.target}">
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

  const totalCells = [team.roster.length, totals.graduating, totals.transferring, totals.projectedDraft, totals.beingCut, ROSTER_TARGET_TOTAL, totals.recruited, totals.stillNeeded]
    .map((value) => `<td><strong>${value}</strong></td>`).join('');

  const content = `<div class="team-needs-view">
    <section class="tn-summary">
      <article><span>Roster</span><strong>${team.roster.length} / ${ROSTER_TARGET_TOTAL}</strong><small>Current / target</small></article>
      <article><span>Graduating</span><strong>${totals.graduating}</strong><small>Projected departures</small></article>
      <article><span>Projected Returning</span><strong>${projectedReturning}</strong><small>After manual departures</small></article>
      <article><span>Still Needed</span><strong>${totals.stillNeeded}</strong><small>${totals.recruited} recruited${team.recruitingAuto ? ' • auto' : ''}</small></article>
    </section>
    <section class="tn-panel">
      <div class="tn-panel-head"><div><span class="eyebrow">85-MAN ROSTER PLAN</span><h2>Team Needs</h2></div><div class="tn-panel-actions"><div class="tn-panel-meta">${esc(team.teamName)} • ${team.roster.length} on roster • ${projectedReturning} projected returning</div><button id="needsOnlyToggle" class="needs-only-toggle${needsOnly ? ' active' : ''}" type="button" aria-pressed="${needsOnly}"><span class="toggle-dot"></span><span>Needs Only</span></button></div></div>
      <div class="tn-table-wrap"><table class="needs-table"><thead><tr><th>Position</th><th>On Team</th><th>Graduating</th><th>Transferring</th><th>Projected Draft</th><th>Being Cut</th><th>Target</th><th>Recruited</th><th>Still Needed</th></tr></thead><tbody>${rows}<tr class="total-row"><td><strong>Total</strong></td>${totalCells}</tr></tbody></table></div>
    </section>
    <p class="tn-footnote"><b>Roster-safe departures:</b> Transferring + Projected Draft + Being Cut can never exceed the non-graduating players available in that position group. Committed recruits auto-populate when available. LG + RG count as OG, LT + RT as OT, LE + RE as EDGE, and SAM + WILL as SAM/WILL.</p>
  </div>`;
  return [status, content];
}

/** Read the edited departure inputs of one row, clamped to what the roster allows. */
export function readManualRow(row: HTMLTableRowElement): { groupKey: string; values: Record<string, number | string> } | null {
  const groupKey = row.dataset.targetGroup;
  const input = (field: string) => row.querySelector<HTMLInputElement>(`input[data-manual-field="${field}"]`);
  const transferring = input('transferring');
  const projectedDraft = input('projectedDraft');
  const beingCut = input('beingCut');
  if (!groupKey || !transferring || !projectedDraft || !beingCut) return null;
  const values: Record<string, number | string> = normalizeTeamNeedsDepartures(
    Number(row.dataset.onTeam ?? 0), Number(row.dataset.graduating ?? 0), transferring.value, projectedDraft.value, beingCut.value,
  );
  const recruited = input('recruited');
  if (recruited && !recruited.readOnly) values.recruited = recruited.value;
  return { groupKey, values };
}

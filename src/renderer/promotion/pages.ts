// HTML for the Promotion / Relegation pages. Each function returns the markup
// for #content; event handling lives in ../app.ts.
import type { DynastySnapshot, StoredSeason, TeamSeason } from '../../shared/types';
import { byName, esc, plural, saveFileName } from '../html';
import {
  alignmentChanged, checkMovements, conferenceLabel, cooldownLabel, countChecks, currentSeason, INDEPENDENT,
  INDEPENDENT_PAIR_KEY, isIndependent, isManualTiebreak, isTracked, lastMove, moveStatus, PAIRS, recommendation,
  teamByIndex, teamsIn, TRACKED_CONFERENCES,
  type IndependentDraft, type MoveCheck, type Pair, type PairDraft, type PromoData, type Recommendation,
} from './rules';

export type PromoPage = 'dashboard' | 'movement' | 'alignment' | 'teams' | 'conferences' | 'history';

const TITLES: Record<PromoPage, string> = {
  dashboard: 'Dynasty Overview',
  movement: 'Promotion / Relegation',
  alignment: 'Current Alignment',
  teams: 'Teams',
  conferences: 'Conferences',
  history: 'History',
};

/** Subtitles before a save is imported. */
const EMPTY_SUBTITLES: Record<PromoPage, string> = {
  dashboard: 'Your conference system at a glance.',
  movement: 'Review automatic recommendations, cooldowns, and manual overrides.',
  alignment: 'The conference membership currently stored in the imported save.',
  teams: 'Current records, conference membership, and movement eligibility.',
  conferences: 'Tier pairings and current membership.',
  history: 'Closed seasons remain editable and can be reopened.',
};

/** Subtitles once a save is loaded. */
const LOADED_SUBTITLES: Record<PromoPage, string> = {
  dashboard: 'What needs attention before you advance.',
  movement: 'Locked season review and movement decisions.',
  alignment: 'Latest synced conference membership.',
  teams: 'Current membership, movement history, and cooldown status.',
  conferences: 'Current tier structure and conference history.',
  history: 'Season-by-season movement archive.',
};

export function promoHeader(page: PromoPage, loaded: boolean): [string, string] {
  return [TITLES[page], (loaded ? LOADED_SUBTITLES : EMPTY_SUBTITLES)[page]];
}

// ---- Shared pieces --------------------------------------------------------------

function phase(snapshot: DynastySnapshot): string {
  const values = [snapshot.currentStage, snapshot.currentWeekType]
    .map((value) => String(value || '').trim())
    .filter((value, index, arr) => value && arr.indexOf(value) === index);
  return values.join(' · ') || 'Save synced';
}

export function promoStatus(data: PromoData | null): string {
  if (!data) return '<span><strong>No dynasty loaded.</strong> Import a save to begin tracking.</span><span>History stays editable.</span>';
  const { review, latest } = data;
  const champions = review.conferenceChampions.filter((champion) => champion.seasonYear === review.seasonYear).length;
  const synced = alignmentChanged(review, latest) ? ' · Latest alignment synced' : '';
  return `<span><strong>${esc(saveFileName(review.filePath))}</strong> · ${review.seasonYear} · ${esc(phase(review))}</span><span>${champions} champions · ${currentSeason(data)?.closed ? 'Closed' : 'Open'}${synced}</span>`;
}

function summaryCards(data: PromoData | null): string {
  if (!data) return '<div class="summary"><article><span>Season</span><strong>—</strong><small>Import dynasty</small></article><article><span>Tracked Teams</span><strong>—</strong><small>10 paired conferences</small></article><article><span>Moves</span><strong>—</strong><small>Current season</small></article><article><span>History</span><strong>—</strong><small>Closed seasons</small></article></div>';
  const season = currentSeason(data);
  const closedSeasons = data.history?.seasons.filter((item) => item.closed).length ?? 0;
  const cards: Array<[string, string | number, string]> = [
    ['Season', data.review.seasonYear, season?.closed ? 'Season closed' : 'Season open'],
    ['Programs', data.latest.teams.filter(isTracked).length, `10 conferences + ${data.latest.teams.filter(isIndependent).length} Independent`],
    ['Moves', season?.movements.length ?? 0, 'Recorded this season'],
    ['History', closedSeasons, 'Closed seasons'],
  ];
  return `<div class="summary">${cards.map(([label, value, note]) => `<article><span>${label}</span><strong>${value}</strong><small>${esc(note)}</small></article>`).join('')}</div>`;
}

function emptyPanel(message: string): string {
  return `<section class="panel empty-panel"><strong>${message}</strong></section>`;
}

function panelHead(eyebrow: string, title: string, aside: string): string {
  return `<div class="panel-head"><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></div>${aside}</div>`;
}

const sortedByName = (teams: TeamSeason[]) => [...teams].sort(byName);

// ---- Dashboard -----------------------------------------------------------------------

function workflowState(data: PromoData) {
  const season = currentSeason(data);
  const counts = countChecks(checkMovements(season?.movements ?? [], data.latest));
  const s = (n: number) => plural(n);
  if (!season?.closed) {
    if (season?.reviewLockedAt) return { tone: 'ready', title: 'Offseason review ready', detail: 'Finalize this season in Promotion / Relegation, then close the year before advancing.', counts };
    return { tone: 'neutral', title: 'Season in progress', detail: 'Sync again when the dynasty reaches the offseason and conference champions are available.', counts };
  }
  if (!counts.total) return { tone: 'success', title: 'Season complete — no movement recorded', detail: 'This season is closed and there are no conference changes to verify.', counts };
  if (counts.mismatch) return { tone: 'warning', title: 'Alignment needs attention', detail: `${counts.mismatch} recorded move${s(counts.mismatch)} do not match the latest game alignment. Check them before advancing.`, counts };
  if (counts.pending) return { tone: 'ready', title: 'In-game conference changes pending', detail: `${counts.pending} recorded move${s(counts.pending)} still show the original conference. Save the changes in-game, then Sync again.`, counts };
  return { tone: 'success', title: 'Season complete — alignment verified', detail: `All ${counts.verified} recorded moves match the latest game alignment. You are clear to advance the dynasty.`, counts };
}

function dashboardPairCard(data: PromoData, pair: Pair, season: StoredSeason | null): string {
  const { review, history } = data;
  const promotion = season?.movements.find((movement) => movement.pairKey === pair.key && movement.kind === 'promotion');
  const relegation = season?.movements.find((movement) => movement.pairKey === pair.key && movement.kind === 'relegation');
  const head = `<div class="dashboard-move-head"><span>${esc(pair.upper)}</span><b>↕</b><span>${esc(pair.lower)}</span></div>`;
  if (!season?.closed && !promotion && !relegation) {
    const champion = review.conferenceChampions.find((row) => row.seasonYear === review.seasonYear && row.conferenceName === pair.lower);
    const championTeam = champion?.championTeamIndex != null ? teamByIndex(review, champion.championTeamIndex) : null;
    const protectedChampion = championTeam ? moveStatus(history, championTeam.teamIndex, review.seasonYear).startsWith('Protected') : false;
    return `<article class="dashboard-move-card open">
      ${head}
      <div class="dashboard-move-line up"><span>↑ TIER 2 CHAMPION</span><strong>${esc(champion?.championName || 'Pending')}</strong><small>${protectedChampion ? 'Protected · no automatic swap' : 'Open review to finalize movement'}</small></div>
      <div class="dashboard-move-line down"><span>↓ RELEGATION</span><strong>${protectedChampion ? 'No automatic swap' : 'Review required'}</strong><small>${protectedChampion ? 'Champion cooldown blocks this pairing' : 'Calculated on Promotion / Relegation'}</small></div>
    </article>`;
  }
  const relegationTag = relegation?.mode === 'manual' ? `<em>${relegation.reason === 'Manual tiebreak' ? 'Manual tiebreak' : 'Manual'}</em>` : '';
  return `<article class="dashboard-move-card${!promotion && !relegation ? ' no-move' : ''}">
    ${head}
    <div class="dashboard-move-line up"><span>↑ PROMOTED</span><strong>${promotion ? esc(promotion.teamName) : 'No promotion'}</strong><small>${promotion ? `${esc(pair.lower)} → ${esc(pair.upper)}` : 'No movement recorded'}</small>${promotion?.mode === 'manual' ? '<em>Manual</em>' : ''}</div>
    <div class="dashboard-move-line down"><span>↓ RELEGATED</span><strong>${relegation ? esc(relegation.teamName) : 'No relegation'}</strong><small>${relegation ? `${esc(pair.upper)} → ${esc(pair.lower)}` : 'No movement recorded'}</small>${relegationTag}</div>
  </article>`;
}

function dashboardIndependentCard(season: StoredSeason | null): string {
  const toIndependent = season?.movements.find((movement) => movement.pairKey === INDEPENDENT_PAIR_KEY && movement.kind === 'to-independent');
  const fromIndependent = season?.movements.find((movement) => movement.pairKey === INDEPENDENT_PAIR_KEY && movement.kind === 'from-independent');
  const head = '<div class="dashboard-move-head"><span>Conference</span><b>⇄</b><span>Independent</span></div>';
  if (!season?.closed && !toIndependent && !fromIndependent) return `<article class="dashboard-move-card open independent">
    ${head}
    <div class="dashboard-independent-open"><span>MANUAL FLEX POOL</span><strong>Optional movement</strong><small>Set Independent moves in Promotion / Relegation if needed.</small></div>
  </article>`;
  return `<article class="dashboard-move-card independent${toIndependent || fromIndependent ? '' : ' no-move'}">
    ${head}
    <div class="dashboard-move-line down"><span>→ TO INDEPENDENT</span><strong>${toIndependent ? esc(toIndependent.teamName) : 'No move'}</strong><small>${toIndependent ? `${esc(toIndependent.fromConference)} → Independent` : 'No movement recorded'}</small>${toIndependent ? '<em>Manual</em>' : ''}</div>
    <div class="dashboard-move-line up"><span>← FROM INDEPENDENT</span><strong>${fromIndependent ? esc(fromIndependent.teamName) : 'No move'}</strong><small>${fromIndependent ? `Independent → ${esc(fromIndependent.toConference)}` : 'No movement recorded'}</small>${fromIndependent ? '<em>Manual</em>' : ''}</div>
  </article>`;
}

export function renderDashboard(data: PromoData | null): string {
  if (!data) {
    const pairs = PAIRS.map((pair) => `<div class="pair-mini"><strong>${pair.label}</strong><span>Import dynasty to calculate</span></div>`).join('');
    return `${summaryCards(null)}<section class="panel">${panelHead('FIVE FEEDER SYSTEMS', 'Movement Board', '<div class="panel-meta">1 up · 1 down · 2-year cooldown</div>')}<div class="pair-grid">${pairs}</div></section>`;
  }
  const { review, history } = data;
  const season = currentSeason(data);
  const closed = Boolean(season?.closed);
  const workflow = workflowState(data);
  const movements = season?.movements ?? [];
  const swaps = new Set(movements.filter((movement) => movement.pairKey !== INDEPENDENT_PAIR_KEY).map((movement) => movement.pairKey)).size;
  const protectedPrograms = review.teams.filter(isTracked).filter((team) => moveStatus(history, team.teamIndex, review.seasonYear).startsWith('Protected')).length;
  const { counts } = workflow;
  const alignmentValue = closed && counts.total ? `${counts.verified}/${counts.total}` : '—';
  const alignmentNote = !closed ? 'Available after season close' : counts.mismatch ? `${counts.mismatch} mismatch` : counts.pending ? `${counts.pending} pending` : counts.total ? 'Verified' : 'No moves to verify';
  const icon = { success: '✓', warning: '!', ready: '◆' }[workflow.tone] ?? '•';
  const workflowPanel = `<section class="dashboard-workflow ${workflow.tone}">
    <div class="dashboard-workflow-icon">${icon}</div>
    <div><span>${review.seasonYear} WORKFLOW</span><strong>${esc(workflow.title)}</strong><p>${esc(workflow.detail)}</p></div>
    <div class="dashboard-workflow-actions"><button class="secondary" data-dashboard-page="movement">${closed ? 'View Review' : 'Open Review'}</button>${closed ? '<button class="secondary" data-dashboard-page="alignment">Current Alignment</button>' : ''}</div>
  </section>`;
  const metrics = `<div class="dashboard-metrics">
    <article><span>Season</span><strong>${review.seasonYear}</strong><small>${closed ? 'Closed' : 'Open review'}</small></article>
    <article><span>Movements</span><strong>${movements.length}</strong><small>${swaps} conference swap${plural(swaps)}</small></article>
    <article><span>Alignment</span><strong>${alignmentValue}</strong><small>${esc(alignmentNote)}</small></article>
    <article><span>Protected</span><strong>${protectedPrograms}</strong></article>
  </div>`;
  const cards = PAIRS.map((pair) => dashboardPairCard(data, pair, season)).join('') + dashboardIndependentCard(season);
  const meta = closed ? `${swaps} swaps · ${movements.length} moves` : 'Review open';
  return `${workflowPanel}${metrics}<section class="panel dashboard-board">${panelHead(`${review.seasonYear} SEASON`, closed ? 'Movement Results' : 'Movement Review', `<div class="panel-meta">${meta}</div>`)}<div class="dashboard-movement-grid">${cards}</div></section>`;
}

// ---- Promotion / Relegation review ------------------------------------------------------

function teamOption(team: TeamSeason, selected: number | null): string {
  return `<option value="${team.teamIndex}"${team.teamIndex === selected ? ' selected' : ''}>${esc(team.displayName)} · ${team.confWins}-${team.confLosses} conf · ${team.overallWins}-${team.overallLosses}</option>`;
}

function relegationOptions(rec: Recommendation, upper: TeamSeason[], selected: number | null): string {
  const manualTiebreak = !rec.relegationCandidate && rec.relegationTied.length > 1;
  if (!manualTiebreak) return `<option value="">No relegation</option>${upper.map((team) => teamOption(team, selected)).join('')}`;
  const tiedIds = new Set(rec.relegationTied.map((team) => team.teamIndex));
  return `<option value=""${selected == null ? ' selected' : ''} disabled>Choose tied team…</option>`
    + `<optgroup label="Tiebreak candidates">${sortedByName(rec.relegationTied).map((team) => teamOption(team, selected)).join('')}</optgroup>`
    + `<optgroup label="Manual override">${upper.filter((team) => !tiedIds.has(team.teamIndex)).map((team) => teamOption(team, selected)).join('')}</optgroup>`;
}

function pairCard(data: PromoData, pair: Pair, draft: PairDraft, closed: boolean): string {
  const { review } = data;
  const rec = recommendation(data, pair);
  const lower = sortedByName(teamsIn(review, pair.lower));
  const upper = sortedByName(teamsIn(review, pair.upper));
  const promoted = teamByIndex(review, draft.promote);
  const relegated = teamByIndex(review, draft.relegate);
  const promotionManual = promoted && promoted.teamIndex !== rec.promotionCandidate?.teamIndex;
  const relegationIsTiebreak = Boolean(relegated && isManualTiebreak(rec, relegated.teamIndex));
  const relegationManual = Boolean(relegated && relegated.teamIndex !== rec.relegationCandidate?.teamIndex && !relegationIsTiebreak);
  const promotionNote = rec.champion
    ? `${rec.champion.displayName} won ${pair.lower}${rec.championProtected ? ` · ${cooldownLabel(data, rec.champion.teamIndex)}` : ''}`
    : `${pair.lower} champion not found`;
  const tieNote = rec.relegationTied.length ? ` · tied: ${rec.relegationTied.map((team) => team.displayName).join(', ')}` : '';
  const relegationStatus = relegated
    ? `${cooldownLabel(data, relegated.teamIndex)}${relegationIsTiebreak ? ' · Manual tiebreak' : relegationManual ? ' · Manual override' : ''}`
    : (!rec.relegationCandidate && rec.relegationTied.length > 1 ? 'Selection required before closing season' : 'No movement');
  // Closed seasons stay editable: changing a selection reopens the season.
  const reopenAttrs = closed ? ' data-auto-reopen="true" title="Changing this selection will reopen the season for editing."' : '';
  return `<article class="movement-card" data-pair="${pair.key}">
      <div class="movement-head"><div><span class="tier">TIER 1</span><strong>${pair.upper}</strong></div><span class="swap">⇅</span><div class="right"><span class="tier">TIER 2</span><strong>${pair.lower}</strong></div></div>
      <div class="recommendation"><span>AUTO RULE</span><p><b>Promotion:</b> ${esc(promotionNote)}</p><p><b>Relegation:</b> ${esc(rec.relegationReason + tieNote)}</p></div>
      <div class="movement-selects">
        <label><span class="move-label up">↑ Promote to ${pair.upper}</span><select data-move="promote"${reopenAttrs}><option value="">No promotion</option>${lower.map((team) => teamOption(team, draft.promote)).join('')}</select><small>${promoted ? esc(cooldownLabel(data, promoted.teamIndex)) : 'No movement'}${promotionManual ? ' · Manual override' : ''}</small></label>
        <label><span class="move-label down">↓ Relegate to ${pair.lower}</span><select data-move="relegate"${reopenAttrs}>${relegationOptions(rec, upper, draft.relegate)}</select><small>${esc(relegationStatus)}</small></label>
      </div>
    </article>`;
}

function independentCard(data: PromoData, draft: IndependentDraft, closed: boolean): string {
  const { review } = data;
  const option = (team: TeamSeason, selected: number | null) =>
    `<option value="${team.teamIndex}"${team.teamIndex === selected ? ' selected' : ''}>${esc(team.displayName)} · ${esc(conferenceLabel(team))} · ${team.overallWins}-${team.overallLosses}</option>`;
  const conferenceTeams = sortedByName(review.teams.filter((team) => TRACKED_CONFERENCES.includes(conferenceLabel(team))));
  const independents = sortedByName(teamsIn(review, INDEPENDENT));
  const toIndependent = teamByIndex(review, draft.toIndependent);
  const fromIndependent = teamByIndex(review, draft.fromIndependent);
  const disabled = closed ? ' disabled' : '';
  const destinationOptions = TRACKED_CONFERENCES.map((conference) => `<option value="${esc(conference)}"${conference === draft.destinationConference ? ' selected' : ''}>${esc(conference)}</option>`).join('');
  return `<article class="movement-card independent-card" data-independent-card>
    <div class="movement-head"><div><span class="tier">MANUAL</span><strong>Conference Team</strong></div><span class="swap">⇄</span><div class="right"><span class="tier">FLEX</span><strong>Independent</strong></div></div>
    <div class="recommendation independent-rule"><span>MANUAL TRACKING</span><p><b>Optional:</b> Record a team moving to Independent, from Independent, or both.</p><p><b>Cooldown:</b> Independent moves use the same 2-year protection history.</p></div>
    <div class="movement-selects independent-selects">
      <label><span class="move-label down">→ Move to Independent</span><select data-independent="to"${disabled}><option value="">No move to Independent</option>${conferenceTeams.map((team) => option(team, draft.toIndependent)).join('')}</select><small>${toIndependent ? esc(cooldownLabel(data, toIndependent.teamIndex)) : 'Optional manual move'}</small></label>
      <label><span class="move-label up">← Move from Independent</span><select data-independent="from"${disabled}><option value="">No move from Independent</option>${independents.map((team) => option(team, draft.fromIndependent)).join('')}</select><select class="destination-select" data-independent="destination"${fromIndependent && !closed ? '' : ' disabled'}><option value="">Choose destination conference…</option>${destinationOptions}</select><small>${fromIndependent ? esc(cooldownLabel(data, fromIndependent.teamIndex)) : `${independents.length} Independent team${plural(independents.length)} available`}</small></label>
    </div>
  </article>`;
}

function verificationCopy(checks: MoveCheck[], changed: boolean): { tone: string; title: string; detail: string } {
  if (!checks.length) {
    if (changed) return { tone: 'warning', title: 'Failsafe active — review snapshot preserved', detail: 'The latest save has different conference membership. Recommendations below still use the locked offseason review snapshot.' };
    return { tone: 'ready', title: 'Offseason review snapshot locked', detail: 'You can make the conference changes in-game, save, then Sync again to verify them without changing this review.' };
  }
  const { verified, pending, mismatch, total } = countChecks(checks);
  if (verified === total) return { tone: 'success', title: `Alignment verified — ${verified}/${total} moves match`, detail: 'The latest synced game save matches every recorded promotion/relegation move for this season.' };
  if (mismatch) return { tone: 'warning', title: `Alignment check — ${verified} verified · ${pending} pending · ${mismatch} mismatch`, detail: 'The locked review is safe. Check the highlighted teams before advancing the dynasty.' };
  return { tone: 'ready', title: `Waiting for in-game changes — ${verified}/${total} verified`, detail: `${pending} recorded move${plural(pending)} still show the original conference in the latest save.` };
}

/** "Sync failsafe" panel: shown once the review is locked, comparing recorded moves with the latest save. */
function verificationPanel(data: PromoData, season: StoredSeason): string {
  const checks = checkMovements(season.movements, data.latest);
  const changed = alignmentChanged(data.review, data.latest);
  const copy = verificationCopy(checks, changed);
  const unresolved = checks.filter((check) => check.state !== 'verified');
  const items = unresolved.length
    ? `<div class="verification-items">${unresolved.map((check) => `<div class="verification-item ${check.state}"><span>${check.state === 'pending' ? '○' : '!'}</span><strong>${esc(check.movement.teamName)}</strong><small>${esc(check.movement.fromConference)} → ${esc(check.movement.toConference)} · latest: ${esc(check.currentConference)}</small></div>`).join('')}</div>`
    : '';
  const icon = copy.tone === 'success' ? '✓' : copy.tone === 'warning' ? '!' : '◆';
  return `<section class="review-verification ${copy.tone}"><div class="verification-icon">${icon}</div><div class="verification-copy"><span class="verification-kicker">SYNC FAILSAFE</span><strong>${esc(copy.title)}</strong><p>${esc(copy.detail)}</p>${items}</div><div class="verification-meta"><span>Review</span><b>${esc(data.review.seasonYear)}</b><small>${changed ? 'Latest alignment differs' : 'Alignment unchanged'}</small></div></section>`;
}

export function renderMovement(data: PromoData | null, draftFor: (pair: Pair) => PairDraft, independent: IndependentDraft): string {
  if (!data) return `${summaryCards(null)}${emptyPanel('Import a dynasty save to calculate promotion and relegation.')}`;
  const year = data.review.seasonYear;
  const season = currentSeason(data);
  const closed = Boolean(season?.closed);
  const verification = season && (season.closed || season.reviewLockedAt) ? verificationPanel(data, season) : '';
  const actions = closed
    ? `<div class="closed-edit-note">Closed · edit a selection to reopen</div><button id="reopenBtn" class="secondary">Reopen ${year}</button>`
    : `<button id="resetRecBtn" class="secondary">Reset Recommendations</button><button id="closeBtn" class="primary">Close ${year}</button>`;
  const cards = PAIRS.map((pair) => pairCard(data, pair, draftFor(pair), closed)).join('') + independentCard(data, independent, closed);
  return `${summaryCards(data)}${verification}<section class="panel">${panelHead(`${year} MOVEMENT REVIEW`, 'Promotion / Relegation', `<div class="panel-actions">${actions}</div>`)}<div class="movement-grid">${cards}</div></section>`;
}

// ---- Current Alignment ---------------------------------------------------------------------

function alignmentTeamList(teams: TeamSeason[]): string {
  if (!teams.length) return '<div class="alignment-empty">No teams</div>';
  return sortedByName(teams).map((team) => `<div class="alignment-team"><strong>${esc(team.displayName)}</strong></div>`).join('');
}

function conferencePoolCount(snapshot: DynastySnapshot): number {
  return TRACKED_CONFERENCES.reduce((sum, conference) => sum + teamsIn(snapshot, conference).length, 0);
}

export function renderAlignment(data: PromoData | null): string {
  if (!data) return emptyPanel('Import a dynasty to view alignment.');
  const { latest } = data;
  const pairCards = PAIRS.map(({ upper, lower }) => {
    const upperTeams = teamsIn(latest, upper);
    const lowerTeams = teamsIn(latest, lower);
    return `<section class="alignment-pair-card">
      <div class="alignment-pair-head">
        <div><span>TIER 1</span><strong>${esc(upper)}</strong><b>${upperTeams.length}</b></div>
        <i>⇅</i>
        <div class="right"><span>TIER 2</span><strong>${esc(lower)}</strong><b>${lowerTeams.length}</b></div>
      </div>
      <div class="alignment-pair-body">
        <div class="alignment-column">${alignmentTeamList(upperTeams)}</div>
        <div class="alignment-column">${alignmentTeamList(lowerTeams)}</div>
      </div>
    </section>`;
  }).join('');
  const independents = teamsIn(latest, INDEPENDENT);
  const independentCard = `<section class="alignment-pair-card alignment-independent">
    <div class="alignment-pair-head">
      <div><span>MANUAL</span><strong>Conference Pool</strong><b>${conferencePoolCount(latest)}</b></div>
      <i>⇄</i>
      <div class="right"><span>FLEX</span><strong>Independent</strong><b>${independents.length}</b></div>
    </div>
    <div class="alignment-independent-body">${alignmentTeamList(independents)}</div>
  </section>`;
  return `<div class="current-source"><span>Latest Sync</span><strong>${latest.seasonYear} game alignment</strong><small>${latest.teams.length} total teams read</small></div><div class="alignment-pair-grid">${pairCards}${independentCard}</div>`;
}

// ---- Teams ------------------------------------------------------------------------------------

function trackedTeams(snapshot: DynastySnapshot): TeamSeason[] {
  return sortedByName(snapshot.teams.filter(isTracked));
}

/** Per-team history table (rendered into #teamHistoryPanel). */
export function renderTeamHistory(data: PromoData, selectedIndex: number | null): { html: string; selectedIndex: number | null } {
  const all = trackedTeams(data.review);
  const selected = all.find((team) => team.teamIndex === selectedIndex) ?? all[0] ?? null;
  const seasons = [...(data.history?.seasons ?? [])].sort((a, b) => b.seasonYear - a.seasonYear);
  const select = `<select class="history-select" data-team-history>${all.map((team) => `<option value="${team.teamIndex}"${team.teamIndex === selected?.teamIndex ? ' selected' : ''}>${esc(team.displayName)}</option>`).join('')}</select>`;
  const movementText = (teamIndex: number, season: StoredSeason) => {
    const moves = season.movements.filter((movement) => movement.teamIndex === teamIndex);
    return moves.length ? moves.map((movement) => `${movement.fromConference} → ${movement.toConference}`).join(' · ') : '—';
  };
  const rows = selected ? seasons.map((season) => {
    const team = season.snapshot.teams.find((item) => item.teamIndex === selected.teamIndex);
    if (!team) return '';
    const independent = isIndependent(team);
    return `<tr><td>${season.seasonYear}</td><td>${esc(conferenceLabel(team))}</td><td>${team.overallWins}-${team.overallLosses}</td><td>${independent ? '—' : `${team.confWins}-${team.confLosses}`}</td><td>${independent ? '—' : team.conferenceStanding || '—'}</td><td>${esc(movementText(team.teamIndex, season))}</td></tr>`;
  }).join('') : '';
  const body = selected
    ? `<div class="history-detail-title"><strong>${esc(selected.displayName)}</strong><span>Conference and movement history</span></div><div class="table-wrap history-detail-table"><table><thead><tr><th>Year</th><th>Conference</th><th>Overall</th><th>Conference</th><th>Finish</th><th>Movement</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="empty-panel"><strong>No tracked teams.</strong></div>';
  return { html: `${panelHead('DYNASTY HISTORY', 'Team History', select)}${body}`, selectedIndex: selected?.teamIndex ?? null };
}

export function renderTeams(data: PromoData | null, teamHistory: string): string {
  if (!data) return emptyPanel('Import a dynasty to view teams.');
  const { review, latest, history } = data;
  const programs = sortedByName(latest.teams.filter(isTracked));
  const rows = programs.map((team) => {
    const move = lastMove(history, team.teamIndex);
    return `<tr><td><strong>${esc(team.displayName)}</strong></td><td>${esc(conferenceLabel(team))}</td><td>${team.overallWins}-${team.overallLosses}</td><td>${move ? `${move.seasonYear} · ${esc(move.fromConference)} → ${esc(move.toConference)}` : '—'}</td><td>${esc(moveStatus(history, team.teamIndex, review.seasonYear))}</td></tr>`;
  }).join('');
  return `<section class="panel">${panelHead('LATEST SYNC', 'Current Teams', `<div class="panel-meta">${programs.length} tracked programs</div>`)}
    <div class="table-wrap"><table><thead><tr><th>Team</th><th>Current Conference</th><th>${latest.seasonYear} Record</th><th>Last Move</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></section>`
    + `<section class="panel tracked-history-panel" id="teamHistoryPanel">${teamHistory}</section>`;
}

// ---- Conferences --------------------------------------------------------------------------------

/** Per-conference history table (rendered into #conferenceHistoryPanel). */
export function renderConferenceHistory(data: PromoData, conference: string): string {
  const options = [...TRACKED_CONFERENCES, INDEPENDENT];
  const seasons = [...(data.history?.seasons ?? [])].sort((a, b) => b.seasonYear - a.seasonYear);
  const champion = (season: StoredSeason) => conference === INDEPENDENT
    ? '—'
    : season.snapshot.conferenceChampions.find((champ) => champ.seasonYear === season.seasonYear && champ.conferenceName === conference)?.championName || '—';
  const moved = (season: StoredSeason, direction: 'in' | 'out') => {
    const matches = season.movements.filter((movement) => (direction === 'in' ? movement.toConference : movement.fromConference) === conference);
    return matches.length ? matches.map((movement) => movement.teamName).join(', ') : '—';
  };
  const select = `<select class="history-select" data-conference-history>${options.map((item) => `<option value="${esc(item)}"${item === conference ? ' selected' : ''}>${esc(item)}</option>`).join('')}</select>`;
  const rows = seasons.map((season) => `<tr><td>${season.seasonYear}</td><td>${teamsIn(season.snapshot, conference).length}</td><td>${esc(champion(season))}</td><td>${esc(moved(season, 'in'))}</td><td>${esc(moved(season, 'out'))}</td></tr>`).join('');
  return `${panelHead('DYNASTY HISTORY', 'Conference History', select)}<div class="table-wrap history-detail-table"><table><thead><tr><th>Year</th><th>Teams</th><th>Champion</th><th>Moved In</th><th>Moved Out</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderConferences(data: PromoData | null, conferenceHistory: string): string {
  if (!data) {
    const rows = PAIRS.map((pair) => `<div><span class="tier-box">TIER 1</span><strong>${pair.upper}</strong><span class="route">↕</span><strong>${pair.lower}</strong><span class="tier-box">TIER 2</span></div>`).join('');
    return `<section class="panel">${panelHead('TWO-TIER SYSTEM', 'Conference Pairings', '<div class="panel-meta">5 promotion paths</div>')}<div class="pairing-list">${rows}</div></section>`;
  }
  const { latest } = data;
  const side = (tier: string, name: string, count: number, right = false) =>
    `<div class="conference-system-side${right ? ' right' : ''}"><span>${tier}</span><strong>${esc(name)}</strong><b>${count} teams</b></div>`;
  const cards = PAIRS.map(({ upper, lower }) => `<div class="conference-system-card">
      ${side('TIER 1', upper, teamsIn(latest, upper).length)}
      <div class="conference-system-route">⇅</div>
      ${side('TIER 2', lower, teamsIn(latest, lower).length, true)}
    </div>`).join('');
  const independentCard = `<div class="conference-system-card independent-system">${side('MANUAL', 'Conference Pool', conferencePoolCount(latest))}<div class="conference-system-route">⇄</div>${side('FLEX', 'Independent', teamsIn(latest, INDEPENDENT).length, true)}</div>`;
  const independents = sortedByName(teamsIn(data.review, INDEPENDENT));
  const independentList = independents.length
    ? independents.map((team) => `<div><strong>${esc(team.displayName)}</strong><span>${team.overallWins}-${team.overallLosses} · ${esc(cooldownLabel(data, team.teamIndex))}</span></div>`).join('')
    : '<div><strong>No Independent teams</strong><span>Current save</span></div>';
  return `<section class="panel">${panelHead('CURRENT STRUCTURE', 'Conference System', `<div class="panel-meta">${latest.seasonYear} latest sync</div>`)}<div class="conference-system-grid">${cards}${independentCard}</div></section>`
    + `<section class="panel independent-roster-panel">${panelHead('CURRENT SAVE', 'Independent', `<div class="panel-meta">${independents.length} teams</div>`)}<div class="simple-list">${independentList}</div></section>`
    + `<section class="panel tracked-history-panel" id="conferenceHistoryPanel">${conferenceHistory}</section>`;
}

// ---- History -----------------------------------------------------------------------------------------

function historyMove(kind: 'promotion' | 'relegation', type: string, name: string | null, emptyName: string, route: string | null, tag: string): string {
  return `<div class="history-move history-${kind}">
          <span class="history-move-type">${type}</span>
          <strong>${name ? esc(name) : emptyName}</strong>
          <small>${route ?? 'No movement recorded'}</small>
          ${tag}
        </div>`;
}

function historyPairCard(season: StoredSeason, pair: Pair): string {
  const promotion = season.movements.find((movement) => movement.pairKey === pair.key && movement.kind === 'promotion');
  const relegation = season.movements.find((movement) => movement.pairKey === pair.key && movement.kind === 'relegation');
  const promotionTag = promotion?.mode === 'manual' ? '<em>Manual override</em>' : '';
  const relegationTag = relegation?.reason === 'Manual tiebreak' ? '<em>Manual tiebreak</em>' : relegation?.mode === 'manual' ? '<em>Manual override</em>' : '';
  return `<div class="history-pair${promotion || relegation ? '' : ' no-move'}">
        <div class="history-pair-head"><span>${esc(pair.upper)}</span><b>↕</b><span>${esc(pair.lower)}</span></div>
        ${historyMove('promotion', '↑ Promoted', promotion?.teamName ?? null, 'No promotion', promotion ? `${esc(pair.lower)} → ${esc(pair.upper)}` : null, promotionTag)}
        ${historyMove('relegation', '↓ Relegated', relegation?.teamName ?? null, 'No relegation', relegation ? `${esc(pair.upper)} → ${esc(pair.lower)}` : null, relegationTag)}
      </div>`;
}

function historyIndependentCard(season: StoredSeason): string {
  const out = season.movements.find((movement) => movement.pairKey === INDEPENDENT_PAIR_KEY && movement.kind === 'to-independent');
  const incoming = season.movements.find((movement) => movement.pairKey === INDEPENDENT_PAIR_KEY && movement.kind === 'from-independent');
  return `<div class="history-pair independent-history${out || incoming ? '' : ' no-move'}"><div class="history-pair-head"><span>Conference</span><b>⇄</b><span>Independent</span></div><div class="history-move history-relegation"><span class="history-move-type">→ To Independent</span><strong>${out ? esc(out.teamName) : 'No move'}</strong><small>${out ? `${esc(out.fromConference)} → Independent` : 'No movement recorded'}</small>${out ? '<em>Manual</em>' : ''}</div><div class="history-move history-promotion"><span class="history-move-type">← From Independent</span><strong>${incoming ? esc(incoming.teamName) : 'No move'}</strong><small>${incoming ? `Independent → ${esc(incoming.toConference)}` : 'No movement recorded'}</small>${incoming ? '<em>Manual</em>' : ''}</div></div>`;
}

export function renderHistory(data: PromoData | null, isCollapsed: (year: number) => boolean): string {
  const history = data?.history;
  if (!history || history.seasons.length === 0) return emptyPanel('No season history yet.');
  const seasons = [...history.seasons].sort((a, b) => b.seasonYear - a.seasonYear);
  const rows = seasons.map((season) => {
    const swaps = new Set(season.movements.map((movement) => movement.pairKey)).size;
    const collapsed = isCollapsed(season.seasonYear);
    const cards = PAIRS.map((pair) => historyPairCard(season, pair)).join('') + historyIndependentCard(season);
    return `<article class="history-season${collapsed ? ' history-collapsed' : ''}">
      <div class="history-season-head">
        <div class="history-year-block"><span class="year">${season.seasonYear}</span><span class="badge ${season.closed ? 'closed' : 'open'}">${season.closed ? 'Closed' : 'Open'}</span></div>
        <div class="history-season-summary"><strong>${swaps} conference swap${plural(swaps)}</strong><span>${season.movements.length} team movements recorded</span></div>
        <div class="history-season-actions"><button type="button" class="secondary history-toggle" data-year="${season.seasonYear}" aria-expanded="${!collapsed}">${collapsed ? 'Expand' : 'Collapse'}</button><button class="secondary history-edit" data-year="${season.seasonYear}">${season.closed ? 'Reopen &amp; Edit' : 'Edit Season'}</button></div>
      </div>
      <div class="history-pair-grid"${collapsed ? ' hidden' : ''}>${cards}</div>
    </article>`;
  }).join('');
  return `<section class="panel">${panelHead('DYNASTY ARCHIVE', 'Season History', `<div class="panel-meta">${history.seasons.length} season snapshots</div>`)}<div class="history-list">${rows}</div></section>`;
}

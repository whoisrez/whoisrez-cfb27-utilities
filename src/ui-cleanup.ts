import './ui-cleanup.css';
import type { DynastyHistory, DynastySnapshot, Movement, TeamSeason } from './types';

const CONFERENCES = ['ACC','American','Big Ten','MAC','Big 12','C-USA','Pac-12','Mountain West','SEC','Sun Belt'];
const PAIRS = [
  ['ACC','American'],
  ['Big Ten','MAC'],
  ['Big 12','C-USA'],
  ['Pac-12','Mountain West'],
  ['SEC','Sun Belt'],
] as const;
const PAIR_KEYS = ['acc-american','bigten-mac','big12-cusa','pac12-mw','sec-sunbelt'] as const;

type PromoApi = {
  getCurrentSnapshot: () => Promise<DynastySnapshot | null>;
  getLatestSnapshot: () => Promise<DynastySnapshot | null>;
  getHistory: (dynastyId: string) => Promise<DynastyHistory | null>;
};

type VerificationCounts = { verified: number; pending: number; mismatch: number; total: number };

const api = (window as unknown as { promoAPI: PromoApi }).promoAPI;
let running = false;

function esc(value: unknown): string {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
function fileName(filePath: string): string {
  const parts = String(filePath || '').split(/[\\/]/);
  return parts[parts.length - 1] || 'Dynasty save';
}
function isIndependent(team: TeamSeason): boolean {
  return `${team.conference ?? ''} ${team.conferenceEnum ?? ''}`.toLowerCase().includes('independent');
}
function conferenceName(team: TeamSeason): string {
  return isIndependent(team) ? 'Independent' : (team.conference ?? '—');
}
function tracked(team: TeamSeason): boolean {
  return isIndependent(team) || CONFERENCES.includes(team.conference ?? '');
}
function teamsIn(source: DynastySnapshot, conference: string): TeamSeason[] {
  if (conference === 'Independent') return source.teams.filter(isIndependent);
  return source.teams.filter((team) => team.conference === conference);
}
function allClosedMovements(history: DynastyHistory | null): Movement[] {
  return (history?.seasons ?? []).filter((season) => season.closed).flatMap((season) => season.movements);
}
function lastMove(teamIndex: number, history: DynastyHistory | null): Movement | null {
  return allClosedMovements(history).filter((move) => move.teamIndex === teamIndex).sort((a,b) => b.seasonYear - a.seasonYear)[0] ?? null;
}
function statusFor(teamIndex: number, year: number, history: DynastyHistory | null): string {
  const move = lastMove(teamIndex, history);
  if (!move) return 'Eligible';
  const diff = year - move.seasonYear;
  if (diff <= 0) return 'Cooldown starts next season';
  if (diff === 1) return 'Protected · 2 seasons';
  if (diff === 2) return 'Protected · 1 season';
  return 'Eligible';
}
function phase(snapshot: DynastySnapshot): string {
  const values = [snapshot.currentStage, snapshot.currentWeekType]
    .map((value) => String(value || '').trim())
    .filter((value, index, arr) => value && arr.indexOf(value) === index);
  return values.join(' · ') || 'Save synced';
}

function cleanHeader(title: string): void {
  const subtitle = document.querySelector<HTMLElement>('#pageSubtitle');
  if (!subtitle) return;
  const labels: Record<string,string> = {
    'Dynasty Overview': 'What needs attention before you advance.',
    'Promotion / Relegation': 'Locked season review and movement decisions.',
    'Current Alignment': 'Latest synced conference membership.',
    'Teams': 'Current membership, movement history, and cooldown status.',
    'Conferences': 'Current tier structure and conference history.',
    'History': 'Season-by-season movement archive.',
  };
  subtitle.textContent = labels[title] ?? '';
}

function cleanStatus(review: DynastySnapshot, latest: DynastySnapshot, history: DynastyHistory | null): void {
  const node = document.querySelector<HTMLElement>('#status');
  if (!node) return;
  const stored = history?.seasons.find((season) => season.seasonYear === review.seasonYear);
  const champions = review.conferenceChampions.filter((champion) => champion.seasonYear === review.seasonYear).length;
  const changed = latest.teams.some((team) => {
    const original = review.teams.find((item) => item.teamIndex === team.teamIndex);
    return original && conferenceName(original) !== conferenceName(team);
  });
  node.innerHTML = `<span><strong>${esc(fileName(review.filePath))}</strong> · ${review.seasonYear} · ${esc(phase(review))}</span><span>${champions} champions · ${stored?.closed ? 'Closed' : 'Open'}${changed ? ' · Latest alignment synced' : ''}</span>`;
}

function cleanSummary(review: DynastySnapshot, latest: DynastySnapshot, history: DynastyHistory | null): void {
  const cards = document.querySelectorAll<HTMLElement>('.summary article');
  if (cards.length !== 4) return;
  const current = history?.seasons.find((season) => season.seasonYear === review.seasonYear);
  const closed = history?.seasons.filter((season) => season.closed).length ?? 0;
  const trackedCount = latest.teams.filter(tracked).length;
  const independentCount = latest.teams.filter(isIndependent).length;
  const values: Array<[string,string,string]> = [
    ['Season', String(review.seasonYear), current?.closed ? 'Season closed' : 'Season open'],
    ['Programs', String(trackedCount), `10 conferences + ${independentCount} Independent`],
    ['Moves', String(current?.movements.length ?? 0), 'Recorded this season'],
    ['History', String(closed), 'Closed seasons'],
  ];
  cards.forEach((card, index) => {
    const [label, value, note] = values[index];
    card.innerHTML = `<span>${label}</span><strong>${value}</strong><small>${esc(note)}</small>`;
  });
}

function alignmentTeamList(teams: TeamSeason[]): string {
  if (!teams.length) return '<div class="alignment-empty">No teams</div>';
  return teams.sort((a,b) => a.displayName.localeCompare(b.displayName)).map((team) => `<div class="alignment-team"><strong>${esc(team.displayName)}</strong></div>`).join('');
}

function renderAlignment(latest: DynastySnapshot): void {
  const content = document.querySelector<HTMLElement>('#content');
  if (!content) return;
  const pairCards = PAIRS.map(([upper, lower]) => {
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
  const independents = teamsIn(latest, 'Independent');
  const independentCard = `<section class="alignment-pair-card alignment-independent" data-independent-panel>
    <div class="alignment-pair-head">
      <div><span>MANUAL</span><strong>Conference Pool</strong><b>${CONFERENCES.reduce((sum, conference) => sum + teamsIn(latest, conference).length, 0)}</b></div>
      <i>⇄</i>
      <div class="right"><span>FLEX</span><strong>Independent</strong><b>${independents.length}</b></div>
    </div>
    <div class="alignment-independent-body">${alignmentTeamList(independents)}</div>
  </section>`;
  content.innerHTML = `<div class="current-source"><span>Latest Sync</span><strong>${latest.seasonYear} game alignment</strong><small>${latest.teams.length} total teams read</small></div><div class="alignment-pair-grid">${pairCards}${independentCard}</div>`;
}

function renderTeams(review: DynastySnapshot, latest: DynastySnapshot, history: DynastyHistory | null): void {
  const content = document.querySelector<HTMLElement>('#content');
  const currentPanel = content?.querySelector<HTMLElement>(':scope > .panel');
  if (!currentPanel) return;
  const programs = latest.teams.filter(tracked).sort((a,b) => a.displayName.localeCompare(b.displayName));
  currentPanel.innerHTML = `<div class="panel-head"><div><span class="eyebrow">LATEST SYNC</span><h2>Current Teams</h2></div><div class="panel-meta">${programs.length} tracked programs</div></div>
    <div class="table-wrap"><table><thead><tr><th>Team</th><th>Current Conference</th><th>${latest.seasonYear} Record</th><th>Last Move</th><th>Status</th></tr></thead><tbody>${programs.map((team) => {
      const move = lastMove(team.teamIndex, history);
      const independentAttr = isIndependent(team) ? ' data-independent-row' : '';
      return `<tr${independentAttr}><td><strong>${esc(team.displayName)}</strong></td><td>${esc(conferenceName(team))}</td><td>${team.overallWins}-${team.overallLosses}</td><td>${move ? `${move.seasonYear} · ${esc(move.fromConference)} → ${esc(move.toConference)}` : '—'}</td><td>${esc(statusFor(team.teamIndex, review.seasonYear, history))}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function renderConferences(latest: DynastySnapshot): void {
  const content = document.querySelector<HTMLElement>('#content');
  const panel = content?.querySelector<HTMLElement>(':scope > .panel');
  if (!panel) return;
  panel.dataset.independentRoster = '';
  const pairCards = PAIRS.map(([upper, lower]) => {
    const upperCount = teamsIn(latest, upper).length;
    const lowerCount = teamsIn(latest, lower).length;
    return `<div class="conference-system-card">
      <div class="conference-system-side"><span>TIER 1</span><strong>${esc(upper)}</strong><b>${upperCount} teams</b></div>
      <div class="conference-system-route">⇅</div>
      <div class="conference-system-side right"><span>TIER 2</span><strong>${esc(lower)}</strong><b>${lowerCount} teams</b></div>
    </div>`;
  }).join('');
  const independentCount = teamsIn(latest, 'Independent').length;
  const conferencePool = CONFERENCES.reduce((sum, conference) => sum + teamsIn(latest, conference).length, 0);
  panel.innerHTML = `<div class="panel-head"><div><span class="eyebrow">CURRENT STRUCTURE</span><h2>Conference System</h2></div><div class="panel-meta">${latest.seasonYear} latest sync</div></div><div class="conference-system-grid">${pairCards}<div class="conference-system-card independent-system" data-independent-pairing><div class="conference-system-side"><span>MANUAL</span><strong>Conference Pool</strong><b>${conferencePool} teams</b></div><div class="conference-system-route">⇄</div><div class="conference-system-side right"><span>FLEX</span><strong>Independent</strong><b>${independentCount} teams</b></div></div></div>`;
}

function verificationCounts(movements: Movement[], latest: DynastySnapshot): VerificationCounts {
  const counts: VerificationCounts = { verified: 0, pending: 0, mismatch: 0, total: movements.length };
  for (const movement of movements) {
    const team = latest.teams.find((item) => item.teamIndex === movement.teamIndex);
    const current = team ? conferenceName(team) : 'Unknown';
    if (current === movement.toConference) counts.verified += 1;
    else if (current === movement.fromConference) counts.pending += 1;
    else counts.mismatch += 1;
  }
  return counts;
}

function dashboardWorkflow(review: DynastySnapshot, latest: DynastySnapshot, history: DynastyHistory | null): { tone: string; title: string; detail: string; counts: VerificationCounts } {
  const season = history?.seasons.find((item) => item.seasonYear === review.seasonYear);
  const movements = season?.movements ?? [];
  const counts = verificationCounts(movements, latest);
  if (!season?.closed) {
    if (season?.reviewLockedAt) return { tone: 'ready', title: 'Offseason review ready', detail: 'Finalize this season in Promotion / Relegation, then close the year before advancing.', counts };
    return { tone: 'neutral', title: 'Season in progress', detail: 'Sync again when the dynasty reaches the offseason and conference champions are available.', counts };
  }
  if (!movements.length) return { tone: 'success', title: 'Season complete — no movement recorded', detail: 'This season is closed and there are no conference changes to verify.', counts };
  if (counts.mismatch) return { tone: 'warning', title: 'Alignment needs attention', detail: `${counts.mismatch} recorded move${counts.mismatch === 1 ? '' : 's'} do not match the latest game alignment. Check them before advancing.`, counts };
  if (counts.pending) return { tone: 'ready', title: 'In-game conference changes pending', detail: `${counts.pending} recorded move${counts.pending === 1 ? '' : 's'} still show the original conference. Save the changes in-game, then Sync again.`, counts };
  return { tone: 'success', title: 'Season complete — alignment verified', detail: `All ${counts.verified} recorded moves match the latest game alignment. You are clear to advance the dynasty.`, counts };
}

function dashboardPairCard(review: DynastySnapshot, history: DynastyHistory | null, index: number): string {
  const season = history?.seasons.find((item) => item.seasonYear === review.seasonYear);
  const [upper, lower] = PAIRS[index];
  const pairKey = PAIR_KEYS[index];
  const promotion = season?.movements.find((movement) => movement.pairKey === pairKey && movement.kind === 'promotion');
  const relegation = season?.movements.find((movement) => movement.pairKey === pairKey && movement.kind === 'relegation');
  const closed = Boolean(season?.closed);
  if (!closed && !promotion && !relegation) {
    const champion = review.conferenceChampions.find((row) => row.seasonYear === review.seasonYear && row.conferenceName === lower);
    const championTeam = champion?.championTeamIndex != null ? review.teams.find((team) => team.teamIndex === champion.championTeamIndex) : null;
    const protectedChampion = championTeam ? statusFor(championTeam.teamIndex, review.seasonYear, history).startsWith('Protected') : false;
    return `<article class="dashboard-move-card open">
      <div class="dashboard-move-head"><span>${esc(upper)}</span><b>↕</b><span>${esc(lower)}</span></div>
      <div class="dashboard-move-line up"><span>↑ TIER 2 CHAMPION</span><strong>${esc(champion?.championName || 'Pending')}</strong><small>${protectedChampion ? 'Protected · no automatic swap' : 'Open review to finalize movement'}</small></div>
      <div class="dashboard-move-line down"><span>↓ RELEGATION</span><strong>${protectedChampion ? 'No automatic swap' : 'Review required'}</strong><small>${protectedChampion ? 'Champion cooldown blocks this pairing' : 'Calculated on Promotion / Relegation'}</small></div>
    </article>`;
  }
  const noMovement = !promotion && !relegation;
  return `<article class="dashboard-move-card${noMovement ? ' no-move' : ''}">
    <div class="dashboard-move-head"><span>${esc(upper)}</span><b>↕</b><span>${esc(lower)}</span></div>
    <div class="dashboard-move-line up"><span>↑ PROMOTED</span><strong>${promotion ? esc(promotion.teamName) : 'No promotion'}</strong><small>${promotion ? `${esc(lower)} → ${esc(upper)}` : 'No movement recorded'}</small>${promotion?.mode === 'manual' ? '<em>Manual</em>' : ''}</div>
    <div class="dashboard-move-line down"><span>↓ RELEGATED</span><strong>${relegation ? esc(relegation.teamName) : 'No relegation'}</strong><small>${relegation ? `${esc(upper)} → ${esc(lower)}` : 'No movement recorded'}</small>${relegation?.mode === 'manual' ? `<em>${relegation.reason === 'Manual tiebreak' ? 'Manual tiebreak' : 'Manual'}</em>` : ''}</div>
  </article>`;
}

function dashboardIndependentCard(review: DynastySnapshot, history: DynastyHistory | null): string {
  const season = history?.seasons.find((item) => item.seasonYear === review.seasonYear);
  const toIndependent = season?.movements.find((movement) => movement.pairKey === 'independent' && movement.kind === 'to-independent');
  const fromIndependent = season?.movements.find((movement) => movement.pairKey === 'independent' && movement.kind === 'from-independent');
  if (!season?.closed && !toIndependent && !fromIndependent) return `<article class="dashboard-move-card open independent">
    <div class="dashboard-move-head"><span>Conference</span><b>⇄</b><span>Independent</span></div>
    <div class="dashboard-independent-open"><span>MANUAL FLEX POOL</span><strong>Optional movement</strong><small>Set Independent moves in Promotion / Relegation if needed.</small></div>
  </article>`;
  return `<article class="dashboard-move-card independent${toIndependent || fromIndependent ? '' : ' no-move'}">
    <div class="dashboard-move-head"><span>Conference</span><b>⇄</b><span>Independent</span></div>
    <div class="dashboard-move-line down"><span>→ TO INDEPENDENT</span><strong>${toIndependent ? esc(toIndependent.teamName) : 'No move'}</strong><small>${toIndependent ? `${esc(toIndependent.fromConference)} → Independent` : 'No movement recorded'}</small>${toIndependent ? '<em>Manual</em>' : ''}</div>
    <div class="dashboard-move-line up"><span>← FROM INDEPENDENT</span><strong>${fromIndependent ? esc(fromIndependent.teamName) : 'No move'}</strong><small>${fromIndependent ? `Independent → ${esc(fromIndependent.toConference)}` : 'No movement recorded'}</small>${fromIndependent ? '<em>Manual</em>' : ''}</div>
  </article>`;
}

function renderDashboard(review: DynastySnapshot, latest: DynastySnapshot, history: DynastyHistory | null): void {
  const content = document.querySelector<HTMLElement>('#content');
  if (!content) return;
  const season = history?.seasons.find((item) => item.seasonYear === review.seasonYear);
  const workflow = dashboardWorkflow(review, latest, history);
  const movements = season?.movements ?? [];
  const swaps = new Set(movements.filter((movement) => movement.pairKey !== 'independent').map((movement) => movement.pairKey)).size;
  const protectedPrograms = review.teams.filter(tracked).filter((team) => statusFor(team.teamIndex, review.seasonYear, history).startsWith('Protected')).length;
  const alignmentValue = season?.closed && workflow.counts.total ? `${workflow.counts.verified}/${workflow.counts.total}` : '—';
  const alignmentNote = !season?.closed ? 'Available after season close' : workflow.counts.mismatch ? `${workflow.counts.mismatch} mismatch` : workflow.counts.pending ? `${workflow.counts.pending} pending` : workflow.counts.total ? 'Verified' : 'No moves to verify';
  const metrics = `<div class="dashboard-metrics">
    <article><span>Season</span><strong>${review.seasonYear}</strong><small>${season?.closed ? 'Closed' : 'Open review'}</small></article>
    <article><span>Movements</span><strong>${movements.length}</strong><small>${swaps} conference swap${swaps === 1 ? '' : 's'}</small></article>
    <article><span>Alignment</span><strong>${alignmentValue}</strong><small>${esc(alignmentNote)}</small></article>
    <article><span>Protected</span><strong>${protectedPrograms}</strong></article>
  </div>`;
  const icon = workflow.tone === 'success' ? '✓' : workflow.tone === 'warning' ? '!' : workflow.tone === 'ready' ? '◆' : '•';
  const workflowPanel = `<section class="dashboard-workflow ${workflow.tone}">
    <div class="dashboard-workflow-icon">${icon}</div>
    <div><span>${review.seasonYear} WORKFLOW</span><strong>${esc(workflow.title)}</strong><p>${esc(workflow.detail)}</p></div>
    <div class="dashboard-workflow-actions"><button class="secondary" data-dashboard-page="movement">${season?.closed ? 'View Review' : 'Open Review'}</button>${season?.closed ? '<button class="secondary" data-dashboard-page="alignment">Current Alignment</button>' : ''}</div>
  </section>`;
  const cards = PAIRS.map((_pair, index) => dashboardPairCard(review, history, index)).join('') + dashboardIndependentCard(review, history);
  content.innerHTML = `${workflowPanel}${metrics}<section class="panel dashboard-board"><div class="panel-head"><div><span class="eyebrow">${review.seasonYear} SEASON</span><h2>${season?.closed ? 'Movement Results' : 'Movement Review'}</h2></div><div class="panel-meta">${season?.closed ? `${swaps} swaps · ${movements.length} moves` : 'Review open'}</div></div><div class="dashboard-movement-grid">${cards}</div></section>`;
}

function cleanMovement(): void { document.querySelector<HTMLElement>('.footnote')?.remove(); }

async function enhance(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const review = await api.getCurrentSnapshot();
    if (!review) return;
    const latest = await api.getLatestSnapshot() ?? review;
    const history = await api.getHistory(review.dynastyId);
    const title = document.querySelector<HTMLElement>('#pageTitle')?.textContent?.trim() ?? '';
    cleanHeader(title);
    cleanStatus(review, latest, history);
    cleanSummary(review, latest, history);
    if (title === 'Dynasty Overview') renderDashboard(review, latest, history);
    else if (title === 'Promotion / Relegation') cleanMovement();
    else if (title === 'Current Alignment') renderAlignment(latest);
    else if (title === 'Teams') renderTeams(review, latest, history);
    else if (title === 'Conferences') renderConferences(latest);
  } catch (error) {
    console.error('UI cleanup:', error);
  } finally {
    running = false;
  }
}

function schedule(): void { setTimeout(() => void enhance(), 0); }
document.addEventListener('click', (event) => {
  const jump = (event.target as HTMLElement).closest<HTMLElement>('[data-dashboard-page]');
  if (jump) {
    const page = jump.dataset.dashboardPage;
    document.querySelector<HTMLButtonElement>(`#nav button[data-page="${page}"]`)?.click();
    return;
  }
  schedule();
});
document.addEventListener('change', schedule);
setTimeout(() => void enhance(), 120);
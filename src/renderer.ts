import './styles.css';
import type { DynastyHistory, DynastySnapshot, Movement, StoredSeason, TeamSeason } from './types';

declare global {
  interface Window {
    promoAPI: {
      chooseAndLoad: () => Promise<DynastySnapshot | null>;
      syncCurrentSave: () => Promise<DynastySnapshot>;
      getHistory: (dynastyId: string) => Promise<DynastyHistory | null>;
      closeSeason: (dynastyId: string, seasonYear: number, movements: Movement[]) => Promise<DynastyHistory>;
      reopenSeason: (dynastyId: string, seasonYear: number) => Promise<DynastyHistory>;
    };
  }
}

type Pair = { key: string; upper: string; lower: string; label: string };
type PairDraft = { promote: number | null; relegate: number | null };
type Recommendation = {
  promotionCandidate: TeamSeason | null;
  champion: TeamSeason | null;
  championProtected: boolean;
  relegationCandidate: TeamSeason | null;
  relegationReason: string;
  relegationTied: TeamSeason[];
  noAutomaticMovement: boolean;
};

const PAIRS: Pair[] = [
  { key: 'acc-american', upper: 'ACC', lower: 'American', label: 'ACC ↕ American' },
  { key: 'bigten-mac', upper: 'Big Ten', lower: 'MAC', label: 'Big Ten ↕ MAC' },
  { key: 'big12-cusa', upper: 'Big 12', lower: 'C-USA', label: 'Big 12 ↕ C-USA' },
  { key: 'pac12-mw', upper: 'Pac-12', lower: 'Mountain West', label: 'Pac-12 ↕ Mountain West' },
  { key: 'sec-sunbelt', upper: 'SEC', lower: 'Sun Belt', label: 'SEC ↕ Sun Belt' },
];

let snapshot: DynastySnapshot | null = null;
let history: DynastyHistory | null = null;
let activePage = 'dashboard';
let drafts = new Map<string, PairDraft>();

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing app root.');

function esc(value: unknown): string {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
function pct(w: number, l: number, t: number): number {
  const games = w + l + t;
  return games ? (w + t * 0.5) / games : 0;
}
function formatPct(value: number): string { return value.toFixed(3).replace(/^0/, ''); }
function saveFileName(filePath: string): string {
  const parts = String(filePath || '').split(/[\\/]/);
  return parts[parts.length - 1] || 'Dynasty save';
}
function currentStoredSeason(): StoredSeason | null {
  if (!snapshot || !history) return null;
  return history.seasons.find((season) => season.seasonYear === snapshot!.seasonYear) ?? null;
}
function teamsIn(conference: string): TeamSeason[] {
  return (snapshot?.teams ?? []).filter((team) => team.conference === conference);
}
function closedMovements(): Movement[] {
  return (history?.seasons ?? []).filter((season) => season.closed).flatMap((season) => season.movements);
}
function lastMovementSeason(teamIndex: number): number | null {
  const currentYear = snapshot?.seasonYear ?? Number.MAX_SAFE_INTEGER;
  const values = closedMovements().filter((movement) => movement.teamIndex === teamIndex && movement.seasonYear < currentYear).map((movement) => movement.seasonYear);
  return values.length ? Math.max(...values) : null;
}
function isProtected(teamIndex: number, seasonYear = snapshot?.seasonYear ?? 0): boolean {
  const last = lastMovementSeason(teamIndex);
  return last != null && seasonYear - last <= 2;
}
function cooldownLabel(teamIndex: number): string {
  if (!snapshot) return '';
  const last = lastMovementSeason(teamIndex);
  if (last == null) return 'Eligible';
  const diff = snapshot.seasonYear - last;
  if (diff > 2) return 'Eligible';
  const remaining = 3 - diff;
  return `Protected · ${remaining} season${remaining === 1 ? '' : 's'}`;
}
function teamByIndex(index: number | null): TeamSeason | null {
  return snapshot?.teams.find((team) => team.teamIndex === index) ?? null;
}
function championFor(conference: string): TeamSeason | null {
  if (!snapshot) return null;
  const row = snapshot.conferenceChampions.find((champ) => champ.seasonYear === snapshot!.seasonYear && champ.conferenceName === conference);
  if (!row) return null;
  if (row.championTeamIndex != null) return teamByIndex(row.championTeamIndex);
  return snapshot.teams.find((team) => team.displayName === row.championName) ?? null;
}
function headToHeadLoser(a: TeamSeason, b: TeamSeason): TeamSeason | null {
  if (!snapshot) return null;
  const games = snapshot.games.filter((game) => game.isFinal &&
    ((game.homeTeamIndex === a.teamIndex && game.awayTeamIndex === b.teamIndex) || (game.homeTeamIndex === b.teamIndex && game.awayTeamIndex === a.teamIndex)));
  if (games.length !== 1) return null;
  const game = games[0];
  if (game.homeScore === game.awayScore) return null;
  const loserIndex = game.homeScore < game.awayScore ? game.homeTeamIndex : game.awayTeamIndex;
  return teamByIndex(loserIndex);
}
function recommendation(pair: Pair): Recommendation {
  const champion = championFor(pair.lower);
  const championProtected = champion ? isProtected(champion.teamIndex) : false;
  const promotionCandidate = champion && !championProtected ? champion : null;
  if (!promotionCandidate) {
    return { promotionCandidate: null, champion, championProtected, relegationCandidate: null, relegationReason: champion ? 'No automatic swap while champion is protected.' : 'Conference champion not found yet.', relegationTied: [], noAutomaticMovement: true };
  }

  const eligible = teamsIn(pair.upper).filter((team) => !isProtected(team.teamIndex));
  if (!eligible.length) return { promotionCandidate, champion, championProtected, relegationCandidate: null, relegationReason: 'No eligible Tier 1 team.', relegationTied: [], noAutomaticMovement: false };
  const ranked = [...eligible].sort((a, b) => {
    const conf = pct(a.confWins,a.confLosses,a.confTies) - pct(b.confWins,b.confLosses,b.confTies);
    if (Math.abs(conf) > 0.000001) return conf;
    const overall = pct(a.overallWins,a.overallLosses,a.overallTies) - pct(b.overallWins,b.overallLosses,b.overallTies);
    if (Math.abs(overall) > 0.000001) return overall;
    return a.displayName.localeCompare(b.displayName);
  });
  const worst = ranked[0];
  const confWorst = pct(worst.confWins,worst.confLosses,worst.confTies);
  const overallWorst = pct(worst.overallWins,worst.overallLosses,worst.overallTies);
  const tied = ranked.filter((team) => Math.abs(pct(team.confWins,team.confLosses,team.confTies) - confWorst) < 0.000001 && Math.abs(pct(team.overallWins,team.overallLosses,team.overallTies) - overallWorst) < 0.000001);
  if (tied.length === 1) {
    const sameConf = eligible.filter((team) => Math.abs(pct(team.confWins,team.confLosses,team.confTies) - confWorst) < 0.000001);
    return { promotionCandidate, champion, championProtected, relegationCandidate: worst, relegationReason: sameConf.length > 1 ? 'Conference record tie → worse overall record' : 'Worst conference winning percentage', relegationTied: [], noAutomaticMovement: false };
  }
  if (tied.length === 2) {
    const loser = headToHeadLoser(tied[0], tied[1]);
    if (loser) return { promotionCandidate, champion, championProtected, relegationCandidate: loser, relegationReason: 'Conference + overall tie → head-to-head loser', relegationTied: tied, noAutomaticMovement: false };
  }
  return { promotionCandidate, champion, championProtected, relegationCandidate: null, relegationReason: 'Manual tiebreak required', relegationTied: tied, noAutomaticMovement: false };
}
function getDraft(pair: Pair): PairDraft {
  const existing = drafts.get(pair.key);
  if (existing) return existing;
  const rec = recommendation(pair);
  const draft = { promote: rec.promotionCandidate?.teamIndex ?? null, relegate: rec.relegationCandidate?.teamIndex ?? null };
  drafts.set(pair.key, draft);
  return draft;
}
function resetDrafts(): void { drafts = new Map(); }

function restoreDraftsFromStoredSeason(season: StoredSeason | null | undefined): void {
  resetDrafts();
  if (!season) return;
  for (const pair of PAIRS) {
    const promotion = season.movements.find((movement) => movement.pairKey === pair.key && movement.kind === 'promotion');
    const relegation = season.movements.find((movement) => movement.pairKey === pair.key && movement.kind === 'relegation');
    if (!promotion && !relegation) continue;
    drafts.set(pair.key, {
      promote: promotion?.teamIndex ?? null,
      relegate: relegation?.teamIndex ?? null,
    });
  }
}

root.innerHTML = `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><div class="mark">27</div><div><span>DYNASTY SYSTEM</span><strong>Promotion<br>Tracker</strong></div></div>
      <nav id="nav">
        <button data-page="dashboard" class="active"><span>01</span>Dashboard</button>
        <button data-page="movement"><span>02</span>Promotion / Relegation</button>
        <button data-page="alignment"><span>03</span>Current Alignment</button>
        <button data-page="teams"><span>04</span>Teams</button>
        <button data-page="conferences"><span>05</span>Conferences</button>
        <button data-page="history"><span>06</span>History</button>
      </nav>
      <div class="sidebar-note">READ-ONLY GAME ACCESS<br><small>The tracker never edits CFB 27 saves.</small></div>
    </aside>
    <main class="workspace">
      <header class="topbar">
        <div><span class="eyebrow">CFB 27 DYNASTY COMPANION</span><h1 id="pageTitle">Promotion / Relegation</h1><p id="pageSubtitle">Track conference movement and history across your dynasty.</p></div>
        <div class="actions"><button id="syncBtn" class="secondary" disabled>Sync</button><button id="importBtn" class="primary">Import Dynasty</button></div>
      </header>
      <div id="status" class="status"><span><strong>No dynasty loaded.</strong> Import a save to begin tracking.</span><span>History stays editable.</span></div>
      <section id="content"></section>
    </main>
  </div>`;

const content = document.querySelector<HTMLElement>('#content')!;
const status = document.querySelector<HTMLElement>('#status')!;
const syncBtn = document.querySelector<HTMLButtonElement>('#syncBtn')!;
const importBtn = document.querySelector<HTMLButtonElement>('#importBtn')!;
const pageTitle = document.querySelector<HTMLElement>('#pageTitle')!;
const pageSubtitle = document.querySelector<HTMLElement>('#pageSubtitle')!;

function pageMeta(): [string,string] {
  const values: Record<string,[string,string]> = {
    dashboard: ['Dynasty Overview','Your conference system at a glance.'],
    movement: ['Promotion / Relegation','Review automatic recommendations, cooldowns, and manual overrides.'],
    alignment: ['Current Alignment','The conference membership currently stored in the imported save.'],
    teams: ['Teams','Current records, conference membership, and movement eligibility.'],
    conferences: ['Conferences','Tier pairings and current membership.'],
    history: ['History','Closed seasons remain editable and can be reopened.'],
  };
  return values[activePage] ?? values.dashboard;
}

function updateStatus(): void {
  if (!snapshot) {
    status.innerHTML = '<span><strong>No dynasty loaded.</strong> Import a save to begin tracking.</span><span>History stays editable.</span>';
    return;
  }
  const stored = currentStoredSeason();
  const phase = [snapshot.currentStage, snapshot.currentWeekType, snapshot.currentWeek ? `Week ${snapshot.currentWeek}` : ''].filter(Boolean).join(' · ');
  status.innerHTML = `<span><strong>${esc(saveFileName(snapshot.filePath))}</strong> · ${esc(snapshot.seasonYear)} loaded · ${snapshot.teams.length} teams · ${snapshot.conferenceChampions.filter((c) => c.seasonYear === snapshot!.seasonYear).length} conference champions found.</span><span>${esc(phase || 'Save state read')} · ${stored?.closed ? 'Season closed' : 'Season open'}</span>`;
}

function summaryCards(): string {
  if (!snapshot) return `<div class="summary"><article><span>Season</span><strong>—</strong><small>Import dynasty</small></article><article><span>Tracked Teams</span><strong>—</strong><small>10 paired conferences</small></article><article><span>Moves</span><strong>—</strong><small>Current season</small></article><article><span>History</span><strong>—</strong><small>Closed seasons</small></article></div>`;
  const moves = currentStoredSeason()?.movements.length ?? 0;
  const closed = history?.seasons.filter((s) => s.closed).length ?? 0;
  const pairedTeams = snapshot.teams.filter((team) => PAIRS.some((pair) => pair.upper === team.conference || pair.lower === team.conference)).length;
  return `<div class="summary"><article><span>Season</span><strong>${snapshot.seasonYear}</strong><small>${esc(saveFileName(snapshot.filePath))} · ${esc(snapshot.currentStage || snapshot.currentWeekType || 'Imported')}</small></article><article><span>Paired Teams</span><strong>${pairedTeams}</strong><small>Across 10 conferences</small></article><article><span>Recorded Moves</span><strong>${moves}</strong><small>This season</small></article><article><span>History</span><strong>${closed}</strong><small>Closed seasons</small></article></div>`;
}

function renderDashboard(): void {
  const pairRows = PAIRS.map((pair) => {
    if (!snapshot) return `<div class="pair-mini"><strong>${pair.label}</strong><span>Import dynasty to calculate</span></div>`;
    const rec = recommendation(pair);
    const up = rec.promotionCandidate?.displayName ?? (rec.championProtected ? `${rec.champion?.displayName} (protected)` : 'Pending');
    const down = rec.relegationCandidate?.displayName ?? (rec.noAutomaticMovement ? 'No automatic swap' : rec.relegationReason);
    return `<div class="pair-mini"><strong>${pair.label}</strong><div><span class="arrow up">↑</span>${esc(up)}</div><div><span class="arrow down">↓</span>${esc(down)}</div></div>`;
  }).join('');
  content.innerHTML = `${summaryCards()}<section class="panel"><div class="panel-head"><div><span class="eyebrow">FIVE FEEDER SYSTEMS</span><h2>Movement Board</h2></div><div class="panel-meta">1 up · 1 down · 2-year cooldown</div></div><div class="pair-grid">${pairRows}</div></section>`;
}

function teamOption(team: TeamSeason, selected: number | null): string {
  return `<option value="${team.teamIndex}"${team.teamIndex === selected ? ' selected' : ''}>${esc(team.displayName)} · ${team.confWins}-${team.confLosses} conf · ${team.overallWins}-${team.overallLosses}</option>`;
}

function relegationOptions(rec: Recommendation, upper: TeamSeason[], selected: number | null): string {
  const manualTiebreak = !rec.relegationCandidate && rec.relegationTied.length > 1;
  if (!manualTiebreak) {
    return `<option value="">No relegation</option>${upper.map((team) => teamOption(team, selected)).join('')}`;
  }

  const tiedIds = new Set(rec.relegationTied.map((team) => team.teamIndex));
  const tied = [...rec.relegationTied].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const overrides = upper.filter((team) => !tiedIds.has(team.teamIndex));
  return `<option value=""${selected == null ? ' selected' : ''} disabled>Choose tied team…</option>`
    + `<optgroup label="Tiebreak candidates">${tied.map((team) => teamOption(team, selected)).join('')}</optgroup>`
    + `<optgroup label="Manual override">${overrides.map((team) => teamOption(team, selected)).join('')}</optgroup>`;
}

function renderMovement(): void {
  if (!snapshot) {
    content.innerHTML = `${summaryCards()}<section class="panel empty-panel"><strong>Import a dynasty save to calculate promotion and relegation.</strong></section>`;
    return;
  }
  const stored = currentStoredSeason();
  const cards = PAIRS.map((pair) => {
    const rec = recommendation(pair);
    const draft = getDraft(pair);
    const lower = teamsIn(pair.lower).sort((a,b) => a.displayName.localeCompare(b.displayName));
    const upper = teamsIn(pair.upper).sort((a,b) => a.displayName.localeCompare(b.displayName));
    const promoted = teamByIndex(draft.promote);
    const relegated = teamByIndex(draft.relegate);
    const promotionManual = promoted && promoted.teamIndex !== rec.promotionCandidate?.teamIndex;
    const relegationIsTiebreak = Boolean(relegated && !rec.relegationCandidate && rec.relegationTied.some((team) => team.teamIndex === relegated.teamIndex));
    const relegationManual = Boolean(relegated && relegated.teamIndex !== rec.relegationCandidate?.teamIndex && !relegationIsTiebreak);
    const promotionNote = rec.champion ? `${rec.champion.displayName} won ${pair.lower}${rec.championProtected ? ` · ${cooldownLabel(rec.champion.teamIndex)}` : ''}` : `${pair.lower} champion not found`;
    const tieNote = rec.relegationTied.length ? ` · tied: ${rec.relegationTied.map((t) => t.displayName).join(', ')}` : '';
    const relegationStatus = relegated
      ? `${cooldownLabel(relegated.teamIndex)}${relegationIsTiebreak ? ' · Manual tiebreak' : relegationManual ? ' · Manual override' : ''}`
      : (!rec.relegationCandidate && rec.relegationTied.length > 1 ? 'Selection required before closing season' : 'No movement');
    return `<article class="movement-card" data-pair="${pair.key}">
      <div class="movement-head"><div><span class="tier">TIER 1</span><strong>${pair.upper}</strong></div><span class="swap">⇅</span><div class="right"><span class="tier">TIER 2</span><strong>${pair.lower}</strong></div></div>
      <div class="recommendation"><span>AUTO RULE</span><p><b>Promotion:</b> ${esc(promotionNote)}</p><p><b>Relegation:</b> ${esc(rec.relegationReason + tieNote)}</p></div>
      <div class="movement-selects">
        <label><span class="move-label up">↑ Promote to ${pair.upper}</span><select data-move="promote"><option value="">No promotion</option>${lower.map((team) => teamOption(team,draft.promote)).join('')}</select><small>${promoted ? esc(cooldownLabel(promoted.teamIndex)) : 'No movement'}${promotionManual ? ' · Manual override' : ''}</small></label>
        <label><span class="move-label down">↓ Relegate to ${pair.lower}</span><select data-move="relegate">${relegationOptions(rec, upper, draft.relegate)}</select><small>${esc(relegationStatus)}</small></label>
      </div>
    </article>`;
  }).join('');
  content.innerHTML = `${summaryCards()}<section class="panel"><div class="panel-head"><div><span class="eyebrow">${snapshot.seasonYear} MOVEMENT REVIEW</span><h2>Promotion / Relegation</h2></div><div class="panel-actions">${stored?.closed ? `<button id="reopenBtn" class="secondary">Reopen ${snapshot.seasonYear}</button>` : `<button id="resetRecBtn" class="secondary">Reset Recommendations</button><button id="closeBtn" class="primary">Close ${snapshot.seasonYear}</button>`}</div></div><div class="movement-grid">${cards}</div></section><p class="footnote">Automatic promotion goes to the Tier 2 conference champion. A team moved in either of the prior two completed seasons is protected. Relegation uses conference winning percentage, then overall winning percentage, then head-to-head when a two-team tie remains. Every selection can be manually overridden.</p>`;
  if (stored?.closed) content.querySelectorAll('select').forEach((el) => (el as HTMLSelectElement).disabled = true);
}

function renderAlignment(): void {
  if (!snapshot) { content.innerHTML = `<section class="panel empty-panel"><strong>Import a dynasty to view alignment.</strong></section>`; return; }
  content.innerHTML = `<div class="conference-grid">${PAIRS.flatMap((pair) => [pair.upper,pair.lower]).map((conference) => `<section class="panel compact"><div class="panel-head"><div><span class="eyebrow">${PAIRS.some((p)=>p.upper===conference)?'TIER 1':'TIER 2'}</span><h2>${conference}</h2></div><div class="panel-meta">${teamsIn(conference).length} teams</div></div><div class="simple-list">${teamsIn(conference).sort((a,b)=>pct(b.confWins,b.confLosses,b.confTies)-pct(a.confWins,a.confLosses,a.confTies)).map((team)=>`<div><strong>${esc(team.displayName)}</strong><span>${team.confWins}-${team.confLosses} conf · ${team.overallWins}-${team.overallLosses}</span></div>`).join('')}</div></section>`).join('')}</div>`;
}

function renderTeams(): void {
  if (!snapshot) { content.innerHTML = `<section class="panel empty-panel"><strong>Import a dynasty to view teams.</strong></section>`; return; }
  const paired = snapshot.teams.filter((team)=>PAIRS.some((p)=>p.upper===team.conference||p.lower===team.conference)).sort((a,b)=>(a.conference??'').localeCompare(b.conference??'')||a.displayName.localeCompare(b.displayName));
  content.innerHTML = `<section class="panel"><div class="panel-head"><div><span class="eyebrow">CURRENT SAVE</span><h2>Teams</h2></div><div class="panel-meta">${paired.length} tracked programs</div></div><div class="table-wrap"><table><thead><tr><th>Team</th><th>Conference</th><th>Overall</th><th>Conference</th><th>Finish</th><th>Cooldown</th></tr></thead><tbody>${paired.map((team)=>`<tr><td><strong>${esc(team.displayName)}</strong></td><td>${esc(team.conference)}</td><td>${team.overallWins}-${team.overallLosses}</td><td>${team.confWins}-${team.confLosses}</td><td>${team.conferenceStanding || '—'}</td><td>${esc(cooldownLabel(team.teamIndex))}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function renderConferences(): void {
  content.innerHTML = `<section class="panel"><div class="panel-head"><div><span class="eyebrow">TWO-TIER SYSTEM</span><h2>Conference Pairings</h2></div><div class="panel-meta">5 promotion paths</div></div><div class="pairing-list">${PAIRS.map((pair)=>`<div><span class="tier-box">TIER 1</span><strong>${pair.upper}</strong><span class="route">↕</span><strong>${pair.lower}</strong><span class="tier-box">TIER 2</span></div>`).join('')}</div></section>`;
}

function renderHistory(): void {
  if (!history || history.seasons.length === 0) { content.innerHTML = `<section class="panel empty-panel"><strong>No season history yet.</strong></section>`; return; }
  const seasons = [...history.seasons].sort((a,b) => b.seasonYear - a.seasonYear);
  const rows = seasons.map((season) => {
    const swaps = new Set(season.movements.map((movement) => movement.pairKey)).size;
    const pairCards = PAIRS.map((pair) => {
      const promotion = season.movements.find((movement) => movement.pairKey === pair.key && movement.kind === 'promotion');
      const relegation = season.movements.find((movement) => movement.pairKey === pair.key && movement.kind === 'relegation');
      const promotionTag = promotion?.mode === 'manual' ? '<em>Manual override</em>' : '';
      const relegationTag = relegation?.reason === 'Manual tiebreak'
        ? '<em>Manual tiebreak</em>'
        : relegation?.mode === 'manual' ? '<em>Manual override</em>' : '';
      return `<div class="history-pair${promotion || relegation ? '' : ' no-move'}">
        <div class="history-pair-head"><span>${esc(pair.upper)}</span><b>↕</b><span>${esc(pair.lower)}</span></div>
        <div class="history-move history-promotion">
          <span class="history-move-type">↑ Promoted</span>
          <strong>${promotion ? esc(promotion.teamName) : 'No promotion'}</strong>
          <small>${promotion ? `${esc(pair.lower)} → ${esc(pair.upper)}` : 'No movement recorded'}</small>
          ${promotionTag}
        </div>
        <div class="history-move history-relegation">
          <span class="history-move-type">↓ Relegated</span>
          <strong>${relegation ? esc(relegation.teamName) : 'No relegation'}</strong>
          <small>${relegation ? `${esc(pair.upper)} → ${esc(pair.lower)}` : 'No movement recorded'}</small>
          ${relegationTag}
        </div>
      </div>`;
    }).join('');
    return `<article class="history-season">
      <div class="history-season-head">
        <div class="history-year-block"><span class="year">${season.seasonYear}</span><span class="badge ${season.closed?'closed':'open'}">${season.closed?'Closed':'Open'}</span></div>
        <div class="history-season-summary"><strong>${swaps} conference swap${swaps === 1 ? '' : 's'}</strong><span>${season.movements.length} team movements recorded</span></div>
        <button class="secondary history-edit" data-year="${season.seasonYear}">${season.closed?'Reopen & Edit':'Edit Season'}</button>
      </div>
      <div class="history-pair-grid">${pairCards}</div>
    </article>`;
  }).join('');
  content.innerHTML = `<section class="panel"><div class="panel-head"><div><span class="eyebrow">DYNASTY ARCHIVE</span><h2>Season History</h2></div><div class="panel-meta">${history.seasons.length} season snapshots</div></div><div class="history-list">${rows}</div></section>`;
}

function render(): void {
  const [title,subtitle] = pageMeta(); pageTitle.textContent = title; pageSubtitle.textContent = subtitle; updateStatus();
  syncBtn.disabled = !snapshot;
  document.querySelectorAll('#nav button').forEach((button)=>button.classList.toggle('active',(button as HTMLElement).dataset.page===activePage));
  if (activePage==='dashboard') renderDashboard();
  else if (activePage==='movement') renderMovement();
  else if (activePage==='alignment') renderAlignment();
  else if (activePage==='teams') renderTeams();
  else if (activePage==='conferences') renderConferences();
  else renderHistory();
}

function movementPayload(): Movement[] {
  if (!snapshot) return [];
  const movements: Movement[] = [];
  for (const pair of PAIRS) {
    const draft = getDraft(pair);
    const rec = recommendation(pair);
    const promoted = teamByIndex(draft.promote);
    const relegated = teamByIndex(draft.relegate);
    if (Boolean(promoted) !== Boolean(relegated)) throw new Error(`${pair.label}: choose both a promotion and relegation, or neither.`);
    if (!promoted || !relegated) continue;
    movements.push({ seasonYear:snapshot.seasonYear,pairKey:pair.key,kind:'promotion',teamIndex:promoted.teamIndex,teamName:promoted.displayName,fromConference:pair.lower,toConference:pair.upper,mode:promoted.teamIndex===rec.promotionCandidate?.teamIndex?'automatic':'manual',reason:promoted.teamIndex===rec.promotionCandidate?.teamIndex?'Conference champion':'Manual override' });
    const isAutomaticRelegation = relegated.teamIndex === rec.relegationCandidate?.teamIndex;
    const isManualTiebreak = !rec.relegationCandidate && rec.relegationTied.some((team) => team.teamIndex === relegated.teamIndex);
    movements.push({ seasonYear:snapshot.seasonYear,pairKey:pair.key,kind:'relegation',teamIndex:relegated.teamIndex,teamName:relegated.displayName,fromConference:pair.upper,toConference:pair.lower,mode:isAutomaticRelegation?'automatic':'manual',reason:isAutomaticRelegation?rec.relegationReason:isManualTiebreak?'Manual tiebreak':'Manual override' });
  }
  return movements;
}

importBtn.addEventListener('click', async () => {
  importBtn.disabled = true; syncBtn.disabled = true; importBtn.textContent = 'Reading Save…';
  try {
    const loaded = await window.promoAPI.chooseAndLoad();
    if (!loaded) return;
    snapshot = loaded;
    history = await window.promoAPI.getHistory(loaded.dynastyId);
    restoreDraftsFromStoredSeason(history?.seasons.find((season) => season.seasonYear === loaded.seasonYear));
    activePage = 'movement'; render();
  } catch (error) {
    status.innerHTML = `<span><strong>Import failed.</strong> ${esc(error instanceof Error ? error.message : String(error))}</span><span>Save was not modified.</span>`;
  } finally { importBtn.disabled = false; syncBtn.disabled = !snapshot; importBtn.textContent = 'Import Dynasty'; }
});

syncBtn.addEventListener('click', async () => {
  if (!snapshot) return;
  syncBtn.disabled = true; importBtn.disabled = true; syncBtn.textContent = 'Syncing…';
  try {
    const loaded = await window.promoAPI.syncCurrentSave();
    snapshot = loaded;
    history = await window.promoAPI.getHistory(loaded.dynastyId);
    restoreDraftsFromStoredSeason(history?.seasons.find((season) => season.seasonYear === loaded.seasonYear));
    render();
  } catch (error) {
    status.innerHTML = `<span><strong>Sync failed.</strong> ${esc(error instanceof Error ? error.message : String(error))}</span><span>The last imported data is still shown.</span>`;
  } finally { importBtn.disabled = false; syncBtn.disabled = !snapshot; syncBtn.textContent = 'Sync'; }
});

document.querySelector('#nav')!.addEventListener('click',(event)=>{
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-page]'); if(!button)return; activePage=button.dataset.page??'dashboard'; render();
});

content.addEventListener('change',(event)=>{
  const select=(event.target as HTMLElement).closest<HTMLSelectElement>('select[data-move]'); if(!select)return;
  const card=select.closest<HTMLElement>('[data-pair]'); const pairKey=card?.dataset.pair; if(!pairKey)return;
  const pair=PAIRS.find((p)=>p.key===pairKey)!; const draft=getDraft(pair); const value=select.value?Number(select.value):null;
  if(select.dataset.move==='promote') draft.promote=value; else draft.relegate=value; drafts.set(pairKey,draft); renderMovement();
});

content.addEventListener('click',async(event)=>{
  const target=event.target as HTMLElement;
  if(target.closest('#resetRecBtn')){resetDrafts();renderMovement();return;}
  if(target.closest('#closeBtn')){
    if(!snapshot)return;
    try{history=await window.promoAPI.closeSeason(snapshot.dynastyId,snapshot.seasonYear,movementPayload());render();}
    catch(error){status.innerHTML=`<span><strong>Could not close season.</strong> ${esc(error instanceof Error?error.message:String(error))}</span><span>Nothing was changed.</span>`;}
    return;
  }
  const historyEdit=target.closest<HTMLElement>('.history-edit');
  if(historyEdit&&history){
    const year=Number(historyEdit.dataset.year); const stored=history.seasons.find((season)=>season.seasonYear===year);
    if(stored){ if(stored.closed) history=await window.promoAPI.reopenSeason(history.dynastyId,year); const refreshed=history.seasons.find((season)=>season.seasonYear===year); const editable=refreshed??stored; snapshot=editable.snapshot; restoreDraftsFromStoredSeason(editable); activePage='movement'; render(); }
    return;
  }
  const reopen=target.closest<HTMLElement>('#reopenBtn');
  if(reopen&&snapshot){history=await window.promoAPI.reopenSeason(snapshot.dynastyId,snapshot.seasonYear);restoreDraftsFromStoredSeason(history.seasons.find((season)=>season.seasonYear===snapshot!.seasonYear));render();}
});

render();
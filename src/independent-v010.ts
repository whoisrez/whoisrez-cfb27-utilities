import './independent.css';
import type { DynastyHistory, DynastySnapshot, Movement, StoredSeason, TeamSeason } from './types';

const TRACKED_CONFERENCES = ['ACC','American','Big Ten','MAC','Big 12','C-USA','Pac-12','Mountain West','SEC','Sun Belt'];

type IndependentDraft = {
  toIndependent: number | null;
  fromIndependent: number | null;
  destinationConference: string | null;
};

type PromoApi = {
  getCurrentSnapshot: () => Promise<DynastySnapshot | null>;
  getHistory: (dynastyId: string) => Promise<DynastyHistory | null>;
  setIndependentMovements: (dynastyId: string, seasonYear: number, movements: Movement[]) => Promise<Movement[]>;
};

const api = (window as unknown as { promoAPI: PromoApi }).promoAPI;
let snapshot: DynastySnapshot | null = null;
let history: DynastyHistory | null = null;
let draft: IndependentDraft = { toIndependent: null, fromIndependent: null, destinationConference: null };
let stateSignature = '';
let selectedTeamHistoryIndex: number | null = null;
let selectedConferenceHistory = 'ACC';
let enhancing = false;

function esc(value: unknown): string {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
function isIndependentText(value: string | null | undefined): boolean {
  return String(value ?? '').trim().toLowerCase().includes('independent');
}
function isIndependentTeam(team: TeamSeason): boolean {
  return isIndependentText(team.conference) || isIndependentText(team.conferenceEnum);
}
function conferenceLabel(team: TeamSeason): string {
  return isIndependentTeam(team) ? 'Independent' : (team.conference ?? '—');
}
function teamsForConference(conference: string, source: DynastySnapshot | null = snapshot): TeamSeason[] {
  if (!source) return [];
  if (conference === 'Independent') return source.teams.filter(isIndependentTeam);
  return source.teams.filter((team) => team.conference === conference);
}
function trackedTeams(source: DynastySnapshot | null = snapshot): TeamSeason[] {
  if (!source) return [];
  return source.teams.filter((team) => TRACKED_CONFERENCES.includes(conferenceLabel(team)) || isIndependentTeam(team));
}
function currentSeason(): StoredSeason | null {
  if (!snapshot || !history) return null;
  return history.seasons.find((season) => season.seasonYear === snapshot!.seasonYear) ?? null;
}
function teamByIndex(index: number | null): TeamSeason | null {
  return snapshot?.teams.find((team) => team.teamIndex === index) ?? null;
}
function closedMovements(): Movement[] {
  return (history?.seasons ?? []).filter((season) => season.closed).flatMap((season) => season.movements);
}
function lastMovementSeason(teamIndex: number): number | null {
  if (!snapshot) return null;
  const years = closedMovements().filter((movement) => movement.teamIndex === teamIndex && movement.seasonYear < snapshot!.seasonYear).map((movement) => movement.seasonYear);
  return years.length ? Math.max(...years) : null;
}
function cooldownLabel(teamIndex: number): string {
  if (!snapshot) return 'Eligible';
  const last = lastMovementSeason(teamIndex);
  if (last == null) return 'Eligible';
  const diff = snapshot.seasonYear - last;
  if (diff > 2) return 'Eligible';
  const remaining = 3 - diff;
  return `Protected · ${remaining} season${remaining === 1 ? '' : 's'}`;
}
function restoreDraft(): void {
  draft = { toIndependent: null, fromIndependent: null, destinationConference: null };
  const season = currentSeason();
  if (!season) return;
  const toIndependent = season.movements.find((movement) => movement.pairKey === 'independent' && movement.kind === 'to-independent');
  const fromIndependent = season.movements.find((movement) => movement.pairKey === 'independent' && movement.kind === 'from-independent');
  draft = {
    toIndependent: toIndependent?.teamIndex ?? null,
    fromIndependent: fromIndependent?.teamIndex ?? null,
    destinationConference: fromIndependent?.toConference ?? null,
  };
}
function independentPayload(): Movement[] {
  if (!snapshot) return [];
  const movements: Movement[] = [];
  const toIndependent = teamByIndex(draft.toIndependent);
  const fromIndependent = teamByIndex(draft.fromIndependent);
  if (toIndependent) {
    movements.push({ seasonYear: snapshot.seasonYear, pairKey: 'independent', kind: 'to-independent', teamIndex: toIndependent.teamIndex, teamName: toIndependent.displayName, fromConference: conferenceLabel(toIndependent), toConference: 'Independent', mode: 'manual', reason: 'Manual Independent move' });
  }
  if (fromIndependent && draft.destinationConference) {
    movements.push({ seasonYear: snapshot.seasonYear, pairKey: 'independent', kind: 'from-independent', teamIndex: fromIndependent.teamIndex, teamName: fromIndependent.displayName, fromConference: 'Independent', toConference: draft.destinationConference, mode: 'manual', reason: 'Manual Independent move' });
  }
  return movements;
}
async function syncPending(): Promise<void> {
  if (!snapshot) return;
  await api.setIndependentMovements(snapshot.dynastyId, snapshot.seasonYear, independentPayload());
}
function seasonSignature(): string {
  const season = currentSeason();
  if (!snapshot) return '';
  return [snapshot.dynastyId, snapshot.seasonYear, season?.closed ?? false, season?.closedAt ?? '', season?.reopenedAt ?? ''].join(':');
}
async function refreshState(): Promise<void> {
  const loaded = await api.getCurrentSnapshot();
  if (!loaded) return;
  snapshot = loaded;
  history = await api.getHistory(loaded.dynastyId);
  const nextSignature = seasonSignature();
  if (nextSignature !== stateSignature) {
    stateSignature = nextSignature;
    restoreDraft();
    await syncPending();
  }
}
function option(team: TeamSeason, selected: number | null): string {
  return `<option value="${team.teamIndex}"${team.teamIndex === selected ? ' selected' : ''}>${esc(team.displayName)} · ${esc(conferenceLabel(team))} · ${team.overallWins}-${team.overallLosses}</option>`;
}
function enhanceSummary(): void {
  if (!snapshot) return;
  const card = document.querySelector<HTMLElement>('.summary article:nth-child(2)');
  if (!card) return;
  const desiredCount = String(trackedTeams().length);
  const desiredLabel = `10 conferences + ${teamsForConference('Independent').length} Independent`;
  const strong = card.querySelector('strong');
  const small = card.querySelector('small');
  if (strong && strong.textContent !== desiredCount) strong.textContent = desiredCount;
  if (small && small.textContent !== desiredLabel) small.textContent = desiredLabel;
}
function injectMovement(): void {
  if (!snapshot) return;
  const grid = document.querySelector<HTMLElement>('.movement-grid');
  if (!grid || grid.querySelector('[data-independent-card]')) return;
  const stored = currentSeason();
  const conferenceTeams = snapshot.teams.filter((team) => TRACKED_CONFERENCES.includes(conferenceLabel(team))).sort((a,b) => a.displayName.localeCompare(b.displayName));
  const independents = teamsForConference('Independent').sort((a,b) => a.displayName.localeCompare(b.displayName));
  const toIndependent = teamByIndex(draft.toIndependent);
  const fromIndependent = teamByIndex(draft.fromIndependent);
  grid.insertAdjacentHTML('beforeend', `<article class="movement-card independent-card" data-independent-card>
    <div class="movement-head"><div><span class="tier">MANUAL</span><strong>Conference Team</strong></div><span class="swap">⇄</span><div class="right"><span class="tier">FLEX</span><strong>Independent</strong></div></div>
    <div class="recommendation independent-rule"><span>MANUAL TRACKING</span><p><b>Optional:</b> Record a team moving to Independent, from Independent, or both.</p><p><b>Cooldown:</b> Independent moves use the same 2-year protection history.</p></div>
    <div class="movement-selects independent-selects">
      <label><span class="move-label down">→ Move to Independent</span><select data-independent="to"><option value="">No move to Independent</option>${conferenceTeams.map((team) => option(team,draft.toIndependent)).join('')}</select><small>${toIndependent ? esc(cooldownLabel(toIndependent.teamIndex)) : 'Optional manual move'}</small></label>
      <label><span class="move-label up">← Move from Independent</span><select data-independent="from"><option value="">No move from Independent</option>${independents.map((team) => option(team,draft.fromIndependent)).join('')}</select><select class="destination-select" data-independent="destination"${fromIndependent ? '' : ' disabled'}><option value="">Choose destination conference…</option>${TRACKED_CONFERENCES.map((conference) => `<option value="${esc(conference)}"${conference === draft.destinationConference ? ' selected' : ''}>${esc(conference)}</option>`).join('')}</select><small>${fromIndependent ? esc(cooldownLabel(fromIndependent.teamIndex)) : `${independents.length} Independent team${independents.length === 1 ? '' : 's'} available`}</small></label>
    </div>
  </article>`);
  if (stored?.closed) grid.querySelectorAll<HTMLSelectElement>('[data-independent-card] select').forEach((select) => select.disabled = true);
  grid.querySelectorAll<HTMLSelectElement>('[data-independent]').forEach((select) => {
    select.addEventListener('change', async () => {
      if (select.dataset.independent === 'to') draft.toIndependent = select.value ? Number(select.value) : null;
      if (select.dataset.independent === 'from') {
        draft.fromIndependent = select.value ? Number(select.value) : null;
        if (!draft.fromIndependent) draft.destinationConference = null;
      }
      if (select.dataset.independent === 'destination') draft.destinationConference = select.value || null;
      await syncPending();
      grid.querySelector('[data-independent-card]')?.remove();
      injectMovement();
    });
  });
}
function injectAlignment(): void {
  if (!snapshot) return;
  const grid = document.querySelector<HTMLElement>('.conference-grid');
  if (!grid || grid.querySelector('[data-independent-panel]')) return;
  const independents = teamsForConference('Independent').sort((a,b) => a.displayName.localeCompare(b.displayName));
  grid.insertAdjacentHTML('beforeend', `<section class="panel compact independent-panel" data-independent-panel><div class="panel-head"><div><span class="eyebrow">FLEX</span><h2>Independent</h2></div><div class="panel-meta">${independents.length} teams</div></div><div class="simple-list">${independents.length ? independents.map((team)=>`<div><strong>${esc(team.displayName)}</strong><span>${team.overallWins}-${team.overallLosses} · ${esc(cooldownLabel(team.teamIndex))}</span></div>`).join('') : '<div><strong>No Independent teams</strong><span>Current save</span></div>'}</div></section>`);
}
function teamMovementText(teamIndex: number, season: StoredSeason): string {
  const moves = season.movements.filter((movement) => movement.teamIndex === teamIndex);
  return moves.length ? moves.map((movement) => `${movement.fromConference} → ${movement.toConference}`).join(' · ') : '—';
}
function renderTeamHistory(panel: HTMLElement): void {
  if (!snapshot || !history) return;
  const all = trackedTeams().sort((a,b)=>a.displayName.localeCompare(b.displayName));
  if (selectedTeamHistoryIndex == null || !all.some((team)=>team.teamIndex===selectedTeamHistoryIndex)) selectedTeamHistoryIndex = all[0]?.teamIndex ?? null;
  const selected = all.find((team)=>team.teamIndex===selectedTeamHistoryIndex) ?? null;
  const seasons = [...history.seasons].sort((a,b)=>b.seasonYear-a.seasonYear);
  panel.innerHTML = `<div class="panel-head"><div><span class="eyebrow">DYNASTY HISTORY</span><h2>Team History</h2></div><select class="history-select" data-team-history>${all.map((team)=>`<option value="${team.teamIndex}"${team.teamIndex===selectedTeamHistoryIndex?' selected':''}>${esc(team.displayName)}</option>`).join('')}</select></div>${selected ? `<div class="history-detail-title"><strong>${esc(selected.displayName)}</strong><span>Conference and movement history</span></div><div class="table-wrap history-detail-table"><table><thead><tr><th>Year</th><th>Conference</th><th>Overall</th><th>Conference</th><th>Finish</th><th>Movement</th></tr></thead><tbody>${seasons.map((season)=>{const team=season.snapshot.teams.find((item)=>item.teamIndex===selected.teamIndex);if(!team)return '';return `<tr><td>${season.seasonYear}</td><td>${esc(conferenceLabel(team))}</td><td>${team.overallWins}-${team.overallLosses}</td><td>${isIndependentTeam(team)?'—':`${team.confWins}-${team.confLosses}`}</td><td>${isIndependentTeam(team)?'—':team.conferenceStanding||'—'}</td><td>${esc(teamMovementText(team.teamIndex,season))}</td></tr>`;}).join('')}</tbody></table></div>` : '<div class="empty-panel"><strong>No tracked teams.</strong></div>'}`;
  panel.querySelector<HTMLSelectElement>('[data-team-history]')?.addEventListener('change',(event)=>{selectedTeamHistoryIndex=Number((event.target as HTMLSelectElement).value);renderTeamHistory(panel);});
}
function injectTeams(): void {
  if (!snapshot) return;
  const currentPanel = document.querySelector<HTMLElement>('#content > .panel');
  if (!currentPanel) return;
  const tbody = currentPanel.querySelector('tbody');
  if (tbody && !tbody.querySelector('[data-independent-row]')) {
    teamsForConference('Independent').sort((a,b)=>a.displayName.localeCompare(b.displayName)).forEach((team)=>tbody.insertAdjacentHTML('beforeend', `<tr data-independent-row><td><strong>${esc(team.displayName)}</strong></td><td>Independent</td><td>${team.overallWins}-${team.overallLosses}</td><td>—</td><td>—</td><td>${esc(cooldownLabel(team.teamIndex))}</td></tr>`));
    const meta=currentPanel.querySelector<HTMLElement>('.panel-meta'); if(meta) meta.textContent=`${trackedTeams().length} tracked programs`;
  }
  if (!document.querySelector('[data-team-history-panel]')) {
    const panel=document.createElement('section'); panel.className='panel tracked-history-panel'; panel.dataset.teamHistoryPanel=''; currentPanel.insertAdjacentElement('afterend',panel); renderTeamHistory(panel);
  }
}
function conferenceChampion(season: StoredSeason, conference: string): string {
  if (conference === 'Independent') return '—';
  return season.snapshot.conferenceChampions.find((champ)=>champ.seasonYear===season.seasonYear&&champ.conferenceName===conference)?.championName || '—';
}
function conferenceMoveNames(season: StoredSeason, conference: string, direction: 'in'|'out'): string {
  const matches=season.movements.filter((movement)=>direction==='in'?movement.toConference===conference:movement.fromConference===conference);
  return matches.length?matches.map((movement)=>movement.teamName).join(', '):'—';
}
function renderConferenceHistory(panel: HTMLElement): void {
  if (!history) return;
  const options=[...TRACKED_CONFERENCES,'Independent'];
  const seasons=[...history.seasons].sort((a,b)=>b.seasonYear-a.seasonYear);
  panel.innerHTML=`<div class="panel-head"><div><span class="eyebrow">DYNASTY HISTORY</span><h2>Conference History</h2></div><select class="history-select" data-conference-history>${options.map((conference)=>`<option value="${esc(conference)}"${conference===selectedConferenceHistory?' selected':''}>${esc(conference)}</option>`).join('')}</select></div><div class="table-wrap history-detail-table"><table><thead><tr><th>Year</th><th>Teams</th><th>Champion</th><th>Moved In</th><th>Moved Out</th></tr></thead><tbody>${seasons.map((season)=>`<tr><td>${season.seasonYear}</td><td>${teamsForConference(selectedConferenceHistory,season.snapshot).length}</td><td>${esc(conferenceChampion(season,selectedConferenceHistory))}</td><td>${esc(conferenceMoveNames(season,selectedConferenceHistory,'in'))}</td><td>${esc(conferenceMoveNames(season,selectedConferenceHistory,'out'))}</td></tr>`).join('')}</tbody></table></div>`;
  panel.querySelector<HTMLSelectElement>('[data-conference-history]')?.addEventListener('change',(event)=>{selectedConferenceHistory=(event.target as HTMLSelectElement).value;renderConferenceHistory(panel);});
}
function injectConferences(): void {
  const pairingList=document.querySelector<HTMLElement>('.pairing-list');
  if (!pairingList) return;
  if (!pairingList.querySelector('[data-independent-pairing]')) pairingList.insertAdjacentHTML('beforeend','<div data-independent-pairing><span class="tier-box">MANUAL</span><strong>Conference Team</strong><span class="route">⇄</span><strong>Independent</strong><span class="tier-box">FLEX</span></div>');
  const basePanel=pairingList.closest<HTMLElement>('.panel'); if(!basePanel)return;
  if(snapshot&&!document.querySelector('[data-independent-roster]')){const independent=teamsForConference('Independent').sort((a,b)=>a.displayName.localeCompare(b.displayName));basePanel.insertAdjacentHTML('afterend',`<section class="panel independent-roster-panel" data-independent-roster><div class="panel-head"><div><span class="eyebrow">CURRENT SAVE</span><h2>Independent</h2></div><div class="panel-meta">${independent.length} teams</div></div><div class="simple-list">${independent.length?independent.map((team)=>`<div><strong>${esc(team.displayName)}</strong><span>${team.overallWins}-${team.overallLosses} · ${esc(cooldownLabel(team.teamIndex))}</span></div>`).join(''):'<div><strong>No Independent teams</strong><span>Current save</span></div>'}</div></section>`);}
  if(history&&!document.querySelector('[data-conference-history-panel]')){const panel=document.createElement('section');panel.className='panel tracked-history-panel';panel.dataset.conferenceHistoryPanel='';(document.querySelector<HTMLElement>('[data-independent-roster]')??basePanel).insertAdjacentElement('afterend',panel);renderConferenceHistory(panel);}
}
function injectHistory(): void {
  if (!history) return;
  document.querySelectorAll<HTMLElement>('.history-season').forEach((article)=>{
    const year=Number(article.querySelector('.year')?.textContent); const season=history!.seasons.find((item)=>item.seasonYear===year); const grid=article.querySelector<HTMLElement>('.history-pair-grid');
    if(!season||!grid||grid.querySelector('[data-independent-history]'))return;
    const out=season.movements.find((movement)=>movement.pairKey==='independent'&&movement.kind==='to-independent');
    const incoming=season.movements.find((movement)=>movement.pairKey==='independent'&&movement.kind==='from-independent');
    grid.insertAdjacentHTML('beforeend',`<div class="history-pair independent-history${out||incoming?'':' no-move'}" data-independent-history><div class="history-pair-head"><span>Conference</span><b>⇄</b><span>Independent</span></div><div class="history-move history-relegation"><span class="history-move-type">→ To Independent</span><strong>${out?esc(out.teamName):'No move'}</strong><small>${out?`${esc(out.fromConference)} → Independent`:'No movement recorded'}</small>${out?'<em>Manual</em>':''}</div><div class="history-move history-promotion"><span class="history-move-type">← From Independent</span><strong>${incoming?esc(incoming.teamName):'No move'}</strong><small>${incoming?`Independent → ${esc(incoming.toConference)}`:'No movement recorded'}</small>${incoming?'<em>Manual</em>':''}</div></div>`);
  });
}
async function enhance(): Promise<void> {
  if (enhancing) return;
  enhancing = true;
  try {
    await refreshState();
    if (!snapshot) return;
    enhanceSummary();
    const title=document.querySelector('#pageTitle')?.textContent?.trim();
    if(title==='Promotion / Relegation') injectMovement();
    else if(title==='Current Alignment') injectAlignment();
    else if(title==='Teams') injectTeams();
    else if(title==='Conferences') injectConferences();
    else if(title==='History') injectHistory();
  } catch (error) {
    console.error('Independent tracker extension:', error);
  } finally {
    enhancing = false;
  }
}

const contentRoot = document.querySelector('#content');
if (contentRoot) new MutationObserver(()=>queueMicrotask(()=>void enhance())).observe(contentRoot,{childList:true});
document.addEventListener('click',()=>setTimeout(()=>void enhance(),0));
document.addEventListener('change',()=>setTimeout(()=>void enhance(),0));
setTimeout(()=>void enhance(),100);

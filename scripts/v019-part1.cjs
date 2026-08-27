const fs=require('fs');const p='src/renderer.ts';let r=fs.readFileSync(p,'utf8');function x(a,b,n){const z=r.replace(a,b);if(z===r)throw new Error('missing '+n);r=z;}
x("import './styles.css';","import './styles.css';\nimport './independent.css';",'css');
x("type PairDraft = { promote: number | null; relegate: number | null };","type PairDraft = { promote: number | null; relegate: number | null };\ntype IndependentDraft = { toIndependent: number | null; fromIndependent: number | null; destinationConference: string | null };",'draft type');
x(/const PAIRS: Pair\[\] = \[[\s\S]*?\n\];/,`const PAIRS: Pair[] = [
  { key: 'acc-american', upper: 'ACC', lower: 'American', label: 'ACC ↕ American' },
  { key: 'bigten-mac', upper: 'Big Ten', lower: 'MAC', label: 'Big Ten ↕ MAC' },
  { key: 'big12-cusa', upper: 'Big 12', lower: 'C-USA', label: 'Big 12 ↕ C-USA' },
  { key: 'pac12-mw', upper: 'Pac-12', lower: 'Mountain West', label: 'Pac-12 ↕ Mountain West' },
  { key: 'sec-sunbelt', upper: 'SEC', lower: 'Sun Belt', label: 'SEC ↕ Sun Belt' },
];
const TRACKED_CONFERENCES = PAIRS.flatMap((pair) => [pair.upper, pair.lower]);`,'pairs');
x("let drafts = new Map<string, PairDraft>();","let drafts = new Map<string, PairDraft>();\nlet independentDraft: IndependentDraft = { toIndependent: null, fromIndependent: null, destinationConference: null };\nlet selectedTeamHistoryIndex: number | null = null;\nlet selectedConferenceHistory = 'ACC';",'state');
x(/function teamsIn\(conference: string\): TeamSeason\[\] \{[\s\S]*?\n\}/,`function isIndependentConference(value: string | null | undefined): boolean {
  return String(value ?? '').trim().toLowerCase().includes('independent');
}
function teamConferenceLabel(team: TeamSeason): string {
  return isIndependentConference(team.conference) ? 'Independent' : (team.conference ?? '—');
}
function teamsForConference(conference: string, source: DynastySnapshot | null = snapshot): TeamSeason[] {
  if (!source) return [];
  if (conference === 'Independent') return source.teams.filter((team) => isIndependentConference(team.conference));
  return source.teams.filter((team) => team.conference === conference);
}
function teamsIn(conference: string): TeamSeason[] { return teamsForConference(conference); }
function trackedTeams(source: DynastySnapshot | null = snapshot): TeamSeason[] {
  if (!source) return [];
  return source.teams.filter((team) => TRACKED_CONFERENCES.includes(teamConferenceLabel(team)) || isIndependentConference(team.conference));
}`,'conference helpers');
x("function resetDrafts(): void { drafts = new Map(); }","function resetDrafts(): void { drafts = new Map(); independentDraft = { toIndependent: null, fromIndependent: null, destinationConference: null }; }",'reset');
x(/function restoreDraftsFromStoredSeason\(season: StoredSeason \| null \| undefined\): void \{[\s\S]*?\n\}\n\nroot\.innerHTML/,`function restoreDraftsFromStoredSeason(season: StoredSeason | null | undefined): void {
  resetDrafts();
  if (!season) return;
  for (const pair of PAIRS) {
    const promotion = season.movements.find((movement) => movement.pairKey === pair.key && movement.kind === 'promotion');
    const relegation = season.movements.find((movement) => movement.pairKey === pair.key && movement.kind === 'relegation');
    if (!promotion && !relegation) continue;
    drafts.set(pair.key, { promote: promotion?.teamIndex ?? null, relegate: relegation?.teamIndex ?? null });
  }
  const toIndependent = season.movements.find((movement) => movement.pairKey === 'independent' && movement.kind === 'to-independent');
  const fromIndependent = season.movements.find((movement) => movement.pairKey === 'independent' && movement.kind === 'from-independent');
  independentDraft = { toIndependent: toIndependent?.teamIndex ?? null, fromIndependent: fromIndependent?.teamIndex ?? null, destinationConference: fromIndependent?.toConference ?? null };
}

root.innerHTML`,'restore');
x(/function summaryCards\(\): string \{[\s\S]*?\n\}\n\nfunction renderDashboard/,`function summaryCards(): string {
  if (!snapshot) return \`<div class="summary"><article><span>Season</span><strong>—</strong><small>Import dynasty</small></article><article><span>Tracked Teams</span><strong>—</strong><small>10 conferences + Independent</small></article><article><span>Moves</span><strong>—</strong><small>Current season</small></article><article><span>History</span><strong>—</strong><small>Closed seasons</small></article></div>\`;
  const moves = currentStoredSeason()?.movements.length ?? 0;
  const closed = history?.seasons.filter((s) => s.closed).length ?? 0;
  return \`<div class="summary"><article><span>Season</span><strong>\${snapshot.seasonYear}</strong><small>\${esc(saveFileName(snapshot.filePath))} · \${esc(snapshot.currentStage || snapshot.currentWeekType || 'Imported')}</small></article><article><span>Tracked Teams</span><strong>\${trackedTeams().length}</strong><small>10 conferences + Independent</small></article><article><span>Recorded Moves</span><strong>\${moves}</strong><small>This season</small></article><article><span>History</span><strong>\${closed}</strong><small>Closed seasons</small></article></div>\`;
}

function renderDashboard`,'summary');
fs.writeFileSync(p,r);console.log('v019 part1');
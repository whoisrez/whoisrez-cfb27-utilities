const fs=require('fs');const p='src/renderer.ts';let r=fs.readFileSync(p,'utf8');function x(a,b,n){const z=r.replace(a,b);if(z===r)throw new Error('missing '+n);r=z;}
x(/function renderTeams\(\): void \{[\s\S]*?\n\}\n\nfunction renderConferences/,`function renderTeams(): void {
  if (!snapshot) { content.innerHTML = \`<section class="panel empty-panel"><strong>Import a dynasty to view teams.</strong></section>\`; return; }
  const programs = trackedTeams().sort((a,b)=>teamConferenceLabel(a).localeCompare(teamConferenceLabel(b))||a.displayName.localeCompare(b.displayName));
  if (selectedTeamHistoryIndex == null || !programs.some((team) => team.teamIndex === selectedTeamHistoryIndex)) selectedTeamHistoryIndex = programs[0]?.teamIndex ?? null;
  const selected = programs.find((team) => team.teamIndex === selectedTeamHistoryIndex) ?? null;
  const seasonRows = selected ? [...(history?.seasons ?? [])].sort((a,b)=>b.seasonYear-a.seasonYear).map((season) => {
    const team = season.snapshot.teams.find((candidate) => candidate.teamIndex === selected.teamIndex);
    if (!team) return '';
    const movement = season.movements.filter((move) => move.teamIndex === selected.teamIndex).map((move) => \`\${move.fromConference} → \${move.toConference}\`).join(' / ') || '—';
    return \`<tr><td><strong>\${season.seasonYear}</strong></td><td>\${esc(teamConferenceLabel(team))}</td><td>\${team.overallWins}-\${team.overallLosses}</td><td>\${isIndependentConference(team.conference) ? '—' : \`\${team.confWins}-\${team.confLosses}\`}</td><td>\${isIndependentConference(team.conference) ? '—' : (team.conferenceStanding || '—')}</td><td>\${esc(movement)}</td></tr>\`;
  }).filter(Boolean).join('') : '';
  content.innerHTML = \`<section class="panel"><div class="panel-head"><div><span class="eyebrow">CURRENT SAVE</span><h2>Teams</h2></div><div class="panel-meta">\${programs.length} tracked programs</div></div><div class="table-wrap teams-current"><table><thead><tr><th>Team</th><th>Conference</th><th>Overall</th><th>Conference</th><th>Finish</th><th>Cooldown</th></tr></thead><tbody>\${programs.map((team)=>\`<tr><td><strong>\${esc(team.displayName)}</strong></td><td>\${esc(teamConferenceLabel(team))}</td><td>\${team.overallWins}-\${team.overallLosses}</td><td>\${isIndependentConference(team.conference) ? '—' : \`\${team.confWins}-\${team.confLosses}\`}</td><td>\${isIndependentConference(team.conference) ? '—' : (team.conferenceStanding || '—')}</td><td>\${esc(cooldownLabel(team.teamIndex))}</td></tr>\`).join('')}</tbody></table></div></section>
  <section class="panel tracked-history-panel"><div class="panel-head"><div><span class="eyebrow">DYNASTY HISTORY</span><h2>Team History</h2></div><select class="history-select" data-team-history>\${programs.map((team)=>\`<option value="\${team.teamIndex}"\${team.teamIndex === selectedTeamHistoryIndex ? ' selected' : ''}>\${esc(team.displayName)}</option>\`).join('')}</select></div>\${selected ? \`<div class="history-detail-title"><strong>\${esc(selected.displayName)}</strong><span>Season-by-season conference membership, records, and recorded movement.</span></div><div class="table-wrap history-detail-table"><table><thead><tr><th>Year</th><th>Conference</th><th>Overall</th><th>Conference</th><th>Finish</th><th>Movement</th></tr></thead><tbody>\${seasonRows || '<tr><td colspan="6">No season snapshots yet.</td></tr>'}</tbody></table></div>\` : '<div class="empty-panel"><strong>No tracked teams found.</strong></div>'}</section>\`;
}

function renderConferences`,'teams');
x(/function renderConferences\(\): void \{[\s\S]*?\n\}\n\nfunction renderHistory/,`function renderConferences(): void {
  const allConferences = [...TRACKED_CONFERENCES, 'Independent'];
  if (!allConferences.includes(selectedConferenceHistory)) selectedConferenceHistory = 'ACC';
  const independentMembers = snapshot ? teamsForConference('Independent').sort((a,b)=>a.displayName.localeCompare(b.displayName)) : [];
  const timeline = [...(history?.seasons ?? [])].sort((a,b)=>b.seasonYear-a.seasonYear).map((season) => {
    const members = teamsForConference(selectedConferenceHistory, season.snapshot);
    const champion = selectedConferenceHistory === 'Independent' ? '—' : (season.snapshot.conferenceChampions.find((entry) => entry.seasonYear === season.seasonYear && entry.conferenceName === selectedConferenceHistory)?.championName ?? '—');
    const incoming = season.movements.filter((move) => move.toConference === selectedConferenceHistory).map((move) => move.teamName).join(', ') || '—';
    const outgoing = season.movements.filter((move) => move.fromConference === selectedConferenceHistory).map((move) => move.teamName).join(', ') || '—';
    return \`<tr><td><strong>\${season.seasonYear}</strong></td><td>\${members.length}</td><td>\${esc(champion)}</td><td>\${esc(incoming)}</td><td>\${esc(outgoing)}</td></tr>\`;
  }).join('');
  content.innerHTML = \`<section class="panel"><div class="panel-head"><div><span class="eyebrow">TWO-TIER SYSTEM</span><h2>Conference Pairings</h2></div><div class="panel-meta">5 promotion paths + Independent</div></div><div class="pairing-list">\${PAIRS.map((pair)=>\`<div><span class="tier-box">TIER 1</span><strong>\${pair.upper}</strong><span class="route">↕</span><strong>\${pair.lower}</strong><span class="tier-box">TIER 2</span></div>\`).join('')}</div></section>
  <section class="panel independent-roster-panel"><div class="panel-head"><div><span class="eyebrow">MANUAL POOL</span><h2>Independent</h2></div><div class="panel-meta">\${independentMembers.length} current teams</div></div><div class="simple-list">\${independentMembers.map((team)=>\`<div><strong>\${esc(team.displayName)}</strong><span>\${team.overallWins}-\${team.overallLosses} · \${esc(cooldownLabel(team.teamIndex))}</span></div>\`).join('') || '<div><strong>Import a dynasty to view Independent teams.</strong><span>Manual movement pool</span></div>'}</div></section>
  <section class="panel tracked-history-panel"><div class="panel-head"><div><span class="eyebrow">DYNASTY HISTORY</span><h2>Conference History</h2></div><select class="history-select" data-conference-history>\${allConferences.map((conference)=>\`<option value="\${esc(conference)}"\${conference === selectedConferenceHistory ? ' selected' : ''}>\${esc(conference)}</option>\`).join('')}</select></div><div class="history-detail-title"><strong>\${esc(selectedConferenceHistory)}</strong><span>Membership count, champions, and movement in/out by season.</span></div><div class="table-wrap history-detail-table"><table><thead><tr><th>Year</th><th>Teams</th><th>Champion</th><th>Moved In</th><th>Moved Out</th></tr></thead><tbody>\${timeline || '<tr><td colspan="5">No season snapshots yet.</td></tr>'}</tbody></table></div></section>\`;
}

function renderHistory`,'conferences');
x(/function renderHistory\(\): void \{[\s\S]*?\n\}\n\nfunction render\(\): void/,`function renderHistory(): void {
  if (!history || history.seasons.length === 0) { content.innerHTML = \`<section class="panel empty-panel"><strong>No season history yet.</strong></section>\`; return; }
  const seasons = [...history.seasons].sort((a,b) => b.seasonYear - a.seasonYear);
  const rows = seasons.map((season) => {
    const pairMoves = season.movements.filter((movement) => PAIRS.some((pair) => pair.key === movement.pairKey));
    const swaps = new Set(pairMoves.map((movement) => movement.pairKey)).size;
    const independentMoves = season.movements.filter((movement) => movement.pairKey === 'independent');
    const pairCards = PAIRS.map((pair) => {
      const promotion = season.movements.find((movement) => movement.pairKey === pair.key && movement.kind === 'promotion');
      const relegation = season.movements.find((movement) => movement.pairKey === pair.key && movement.kind === 'relegation');
      const promotionTag = promotion?.mode === 'manual' ? '<em>Manual override</em>' : '';
      const relegationTag = relegation?.reason === 'Manual tiebreak' ? '<em>Manual tiebreak</em>' : relegation?.mode === 'manual' ? '<em>Manual override</em>' : '';
      return \`<div class="history-pair\${promotion || relegation ? '' : ' no-move'}"><div class="history-pair-head"><span>\${esc(pair.upper)}</span><b>↕</b><span>\${esc(pair.lower)}</span></div><div class="history-move history-promotion"><span class="history-move-type">↑ Promoted</span><strong>\${promotion ? esc(promotion.teamName) : 'No promotion'}</strong><small>\${promotion ? \`\${esc(pair.lower)} → \${esc(pair.upper)}\` : 'No movement recorded'}</small>\${promotionTag}</div><div class="history-move history-relegation"><span class="history-move-type">↓ Relegated</span><strong>\${relegation ? esc(relegation.teamName) : 'No relegation'}</strong><small>\${relegation ? \`\${esc(pair.upper)} → \${esc(pair.lower)}\` : 'No movement recorded'}</small>\${relegationTag}</div></div>\`;
    }).join('');
    const toIndependent = independentMoves.find((movement) => movement.kind === 'to-independent');
    const fromIndependent = independentMoves.find((movement) => movement.kind === 'from-independent');
    const independentCard = \`<div class="history-pair independent-history\${toIndependent || fromIndependent ? '' : ' no-move'}"><div class="history-pair-head"><span>Conference</span><b>⇄</b><span>Independent</span></div><div class="history-move history-relegation"><span class="history-move-type">→ To Independent</span><strong>\${toIndependent ? esc(toIndependent.teamName) : 'No move'}</strong><small>\${toIndependent ? \`\${esc(toIndependent.fromConference)} → Independent\` : 'No movement recorded'}</small>\${toIndependent ? '<em>Manual</em>' : ''}</div><div class="history-move history-promotion"><span class="history-move-type">← From Independent</span><strong>\${fromIndependent ? esc(fromIndependent.teamName) : 'No move'}</strong><small>\${fromIndependent ? \`Independent → \${esc(fromIndependent.toConference)}\` : 'No movement recorded'}</small>\${fromIndependent ? '<em>Manual</em>' : ''}</div></div>\`;
    return \`<article class="history-season"><div class="history-season-head"><div class="history-year-block"><span class="year">\${season.seasonYear}</span><span class="badge \${season.closed?'closed':'open'}">\${season.closed?'Closed':'Open'}</span></div><div class="history-season-summary"><strong>\${swaps} conference swap\${swaps === 1 ? '' : 's'}</strong><span>\${independentMoves.length} independent move\${independentMoves.length === 1 ? '' : 's'} · \${season.movements.length} total team movements</span></div><button class="secondary history-edit" data-year="\${season.seasonYear}">\${season.closed?'Reopen & Edit':'Edit Season'}</button></div><div class="history-pair-grid">\${pairCards}\${independentCard}</div></article>\`;
  }).join('');
  content.innerHTML = \`<section class="panel"><div class="panel-head"><div><span class="eyebrow">DYNASTY ARCHIVE</span><h2>Season History</h2></div><div class="panel-meta">\${history.seasons.length} season snapshots</div></div><div class="history-list">\${rows}</div></section>\`;
}

function render(): void`,'history');
fs.writeFileSync(p,r);console.log('v019 part3');
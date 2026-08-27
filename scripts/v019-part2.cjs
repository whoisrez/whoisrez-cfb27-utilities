const fs=require('fs');const p='src/renderer.ts';let r=fs.readFileSync(p,'utf8');function x(a,b,n){const z=r.replace(a,b);if(z===r)throw new Error('missing '+n);r=z;}
x(/function renderMovement\(\): void \{[\s\S]*?\n\}\n\nfunction renderAlignment/,`function renderMovement(): void {
  if (!snapshot) {
    content.innerHTML = \`\${summaryCards()}<section class="panel empty-panel"><strong>Import a dynasty save to calculate promotion and relegation.</strong></section>\`;
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
    const promotionNote = rec.champion ? \`\${rec.champion.displayName} won \${pair.lower}\${rec.championProtected ? \` · \${cooldownLabel(rec.champion.teamIndex)}\` : ''}\` : \`\${pair.lower} champion not found\`;
    const tieNote = rec.relegationTied.length ? \` · tied: \${rec.relegationTied.map((t) => t.displayName).join(', ')}\` : '';
    const relegationStatus = relegated ? \`\${cooldownLabel(relegated.teamIndex)}\${relegationIsTiebreak ? ' · Manual tiebreak' : relegationManual ? ' · Manual override' : ''}\` : (!rec.relegationCandidate && rec.relegationTied.length > 1 ? 'Selection required before closing season' : 'No movement');
    return \`<article class="movement-card" data-pair="\${pair.key}">
      <div class="movement-head"><div><span class="tier">TIER 1</span><strong>\${pair.upper}</strong></div><span class="swap">⇅</span><div class="right"><span class="tier">TIER 2</span><strong>\${pair.lower}</strong></div></div>
      <div class="recommendation"><span>AUTO RULE</span><p><b>Promotion:</b> \${esc(promotionNote)}</p><p><b>Relegation:</b> \${esc(rec.relegationReason + tieNote)}</p></div>
      <div class="movement-selects">
        <label><span class="move-label up">↑ Promote to \${pair.upper}</span><select data-move="promote"><option value="">No promotion</option>\${lower.map((team) => teamOption(team,draft.promote)).join('')}</select><small>\${promoted ? esc(cooldownLabel(promoted.teamIndex)) : 'No movement'}\${promotionManual ? ' · Manual override' : ''}</small></label>
        <label><span class="move-label down">↓ Relegate to \${pair.lower}</span><select data-move="relegate">\${relegationOptions(rec, upper, draft.relegate)}</select><small>\${esc(relegationStatus)}</small></label>
      </div>
    </article>\`;
  }).join('');
  const independents = teamsIn('Independent').sort((a,b) => a.displayName.localeCompare(b.displayName));
  const conferencePrograms = trackedTeams().filter((team) => !isIndependentConference(team.conference)).sort((a,b) => teamConferenceLabel(a).localeCompare(teamConferenceLabel(b)) || a.displayName.localeCompare(b.displayName));
  const toIndependent = teamByIndex(independentDraft.toIndependent);
  const fromIndependent = teamByIndex(independentDraft.fromIndependent);
  const independentCard = \`<article class="movement-card independent-card" data-independent-card>
    <div class="movement-head"><div><span class="tier">MANUAL</span><strong>Conference Team</strong></div><span class="swap">⇄</span><div class="right"><span class="tier">MANUAL POOL</span><strong>Independent</strong></div></div>
    <div class="recommendation independent-rule"><span>MANUAL TRACKING</span><p><b>No automatic rule:</b> Independent movement is optional and controlled entirely by you.</p><p><b>Cooldown:</b> Any team moved to or from Independent starts the same 2 completed-season protection period.</p></div>
    <div class="movement-selects independent-selects">
      <label><span class="move-label down">→ Move to Independent</span><select data-independent="to-independent"><option value="">No move to Independent</option>\${conferencePrograms.map((team) => \`<option value="\${team.teamIndex}"\${team.teamIndex === independentDraft.toIndependent ? ' selected' : ''}>\${esc(team.displayName)} · \${esc(teamConferenceLabel(team))} · \${team.overallWins}-\${team.overallLosses}</option>\`).join('')}</select><small>\${toIndependent ? \`\${esc(cooldownLabel(toIndependent.teamIndex))} · Manual move\` : 'Optional'}</small></label>
      <label><span class="move-label up">← Move from Independent</span><select data-independent="from-independent"><option value="">No move from Independent</option>\${independents.map((team) => \`<option value="\${team.teamIndex}"\${team.teamIndex === independentDraft.fromIndependent ? ' selected' : ''}>\${esc(team.displayName)} · \${team.overallWins}-\${team.overallLosses}</option>\`).join('')}</select><select class="destination-select" data-independent="destination"\${fromIndependent ? '' : ' disabled'}><option value="">Choose destination conference…</option>\${TRACKED_CONFERENCES.map((conference) => \`<option value="\${esc(conference)}"\${conference === independentDraft.destinationConference ? ' selected' : ''}>\${esc(conference)}</option>\`).join('')}</select><small>\${fromIndependent ? \`\${esc(cooldownLabel(fromIndependent.teamIndex))} · Manual move\` : 'Optional'}</small></label>
    </div>
  </article>\`;
  content.innerHTML = \`\${summaryCards()}<section class="panel"><div class="panel-head"><div><span class="eyebrow">\${snapshot.seasonYear} MOVEMENT REVIEW</span><h2>Promotion / Relegation</h2></div><div class="panel-actions">\${stored?.closed ? \`<button id="reopenBtn" class="secondary">Reopen \${snapshot.seasonYear}</button>\` : \`<button id="resetRecBtn" class="secondary">Reset Recommendations</button><button id="closeBtn" class="primary">Close \${snapshot.seasonYear}</button>\`}</div></div><div class="movement-grid">\${cards}\${independentCard}</div></section><p class="footnote">Automatic promotion goes to the Tier 2 conference champion. A team moved in either of the prior two completed seasons is protected. Relegation uses conference winning percentage, then overall winning percentage, then head-to-head when a two-team tie remains. Independent movement is manual-only. Every selection can be manually overridden.</p>\`;
  if (stored?.closed) content.querySelectorAll('select').forEach((el) => (el as HTMLSelectElement).disabled = true);
}

function renderAlignment`,'movement');
x(/function renderAlignment\(\): void \{[\s\S]*?\n\}\n\nfunction renderTeams/,`function renderAlignment(): void {
  if (!snapshot) { content.innerHTML = \`<section class="panel empty-panel"><strong>Import a dynasty to view alignment.</strong></section>\`; return; }
  const conferences = [...TRACKED_CONFERENCES, 'Independent'];
  content.innerHTML = \`<div class="conference-grid">\${conferences.map((conference) => {
    const members = teamsForConference(conference).sort((a,b)=> conference === 'Independent' ? a.displayName.localeCompare(b.displayName) : pct(b.confWins,b.confLosses,b.confTies)-pct(a.confWins,a.confLosses,a.confTies));
    const tier = conference === 'Independent' ? 'MANUAL POOL' : PAIRS.some((p)=>p.upper===conference) ? 'TIER 1' : 'TIER 2';
    return \`<section class="panel compact\${conference === 'Independent' ? ' independent-panel' : ''}"><div class="panel-head"><div><span class="eyebrow">\${tier}</span><h2>\${conference}</h2></div><div class="panel-meta">\${members.length} teams</div></div><div class="simple-list">\${members.map((team)=>\`<div><strong>\${esc(team.displayName)}</strong><span>\${conference === 'Independent' ? \`\${team.overallWins}-\${team.overallLosses} overall\` : \`\${team.confWins}-\${team.confLosses} conf · \${team.overallWins}-\${team.overallLosses}\`}</span></div>\`).join('') || '<div><strong>No independent teams found.</strong><span>Current save</span></div>'}</div></section>\`;
  }).join('')}</div>\`;
}

function renderTeams`,'alignment');
fs.writeFileSync(p,r);console.log('v019 part2');
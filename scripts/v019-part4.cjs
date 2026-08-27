const fs=require('fs');const p='src/renderer.ts';let r=fs.readFileSync(p,'utf8');function x(a,b,n){const z=r.replace(a,b);if(z===r)throw new Error('missing '+n);r=z;}
x(/function movementPayload\(\): Movement\[\] \{[\s\S]*?\n\}\n\nimportBtn\.addEventListener/,`function movementPayload(): Movement[] {
  if (!snapshot) return [];
  const movements: Movement[] = [];
  for (const pair of PAIRS) {
    const draft = getDraft(pair);
    const rec = recommendation(pair);
    const promoted = teamByIndex(draft.promote);
    const relegated = teamByIndex(draft.relegate);
    if (Boolean(promoted) !== Boolean(relegated)) throw new Error(\`\${pair.label}: choose both a promotion and relegation, or neither.\`);
    if (!promoted || !relegated) continue;
    movements.push({ seasonYear:snapshot.seasonYear,pairKey:pair.key,kind:'promotion',teamIndex:promoted.teamIndex,teamName:promoted.displayName,fromConference:pair.lower,toConference:pair.upper,mode:promoted.teamIndex===rec.promotionCandidate?.teamIndex?'automatic':'manual',reason:promoted.teamIndex===rec.promotionCandidate?.teamIndex?'Conference champion':'Manual override' });
    const isAutomaticRelegation = relegated.teamIndex === rec.relegationCandidate?.teamIndex;
    const isManualTiebreak = !rec.relegationCandidate && rec.relegationTied.some((team) => team.teamIndex === relegated.teamIndex);
    movements.push({ seasonYear:snapshot.seasonYear,pairKey:pair.key,kind:'relegation',teamIndex:relegated.teamIndex,teamName:relegated.displayName,fromConference:pair.upper,toConference:pair.lower,mode:isAutomaticRelegation?'automatic':'manual',reason:isAutomaticRelegation?rec.relegationReason:isManualTiebreak?'Manual tiebreak':'Manual override' });
  }
  const toIndependent = teamByIndex(independentDraft.toIndependent);
  if (toIndependent) movements.push({ seasonYear:snapshot.seasonYear,pairKey:'independent',kind:'to-independent',teamIndex:toIndependent.teamIndex,teamName:toIndependent.displayName,fromConference:teamConferenceLabel(toIndependent),toConference:'Independent',mode:'manual',reason:'Manual independent move' });
  const fromIndependent = teamByIndex(independentDraft.fromIndependent);
  if (fromIndependent) {
    if (!independentDraft.destinationConference) throw new Error('Independent: choose a destination conference for the team moving from Independent.');
    movements.push({ seasonYear:snapshot.seasonYear,pairKey:'independent',kind:'from-independent',teamIndex:fromIndependent.teamIndex,teamName:fromIndependent.displayName,fromConference:'Independent',toConference:independentDraft.destinationConference,mode:'manual',reason:'Manual independent move' });
  }
  return movements;
}

importBtn.addEventListener`,'payload');
x(/content\.addEventListener\('change',\(event\)=>\{[\s\S]*?\n\}\);\n\ncontent\.addEventListener\('click'/,`content.addEventListener('change',(event)=>{
  const target = event.target as HTMLElement;
  const independentSelect = target.closest<HTMLSelectElement>('select[data-independent]');
  if (independentSelect) {
    const kind = independentSelect.dataset.independent;
    if (kind === 'to-independent') independentDraft.toIndependent = independentSelect.value ? Number(independentSelect.value) : null;
    if (kind === 'from-independent') { independentDraft.fromIndependent = independentSelect.value ? Number(independentSelect.value) : null; if (independentDraft.fromIndependent == null) independentDraft.destinationConference = null; }
    if (kind === 'destination') independentDraft.destinationConference = independentSelect.value || null;
    renderMovement(); return;
  }
  const teamHistorySelect = target.closest<HTMLSelectElement>('select[data-team-history]');
  if (teamHistorySelect) { selectedTeamHistoryIndex = Number(teamHistorySelect.value); renderTeams(); return; }
  const conferenceHistorySelect = target.closest<HTMLSelectElement>('select[data-conference-history]');
  if (conferenceHistorySelect) { selectedConferenceHistory = conferenceHistorySelect.value; renderConferences(); return; }
  const select=target.closest<HTMLSelectElement>('select[data-move]'); if(!select)return;
  const card=select.closest<HTMLElement>('[data-pair]'); const pairKey=card?.dataset.pair; if(!pairKey)return;
  const pair=PAIRS.find((p)=>p.key===pairKey)!; const draft=getDraft(pair); const value=select.value?Number(select.value):null;
  if(select.dataset.move==='promote') draft.promote=value; else draft.relegate=value; drafts.set(pairKey,draft); renderMovement();
});

content.addEventListener('click'`,'change handler');
fs.writeFileSync(p,r);
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));pkg.version='0.1.9';fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');
let readme=fs.readFileSync('README.md','utf8');readme=readme.replace(/## Current build: v[0-9.]+/,'## Current build: v0.1.9');if(!readme.includes('### v0.1.9'))readme=readme.replace('## Changelog\n\n','## Changelog\n\n### v0.1.9\n- Added Independent teams as a tracked manual movement pool.\n- Added a sixth Promotion/Relegation card for optional moves to or from Independent.\n- Independent moves persist in history, restore on reopen, and use the same 2-year cooldown.\n- Current Alignment and Teams now include Independent programs.\n- Added season-by-season Team History and Conference History views.\n\n');fs.writeFileSync('README.md',readme);
console.log('v019 part4');
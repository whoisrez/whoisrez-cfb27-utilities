import './review-verification.css';
import type { DynastyHistory, DynastySnapshot, Movement, StoredSeason, TeamSeason } from './types';

type PromoApi = {
  getCurrentSnapshot: () => Promise<DynastySnapshot | null>;
  getLatestSnapshot: () => Promise<DynastySnapshot | null>;
  getHistory: (dynastyId: string) => Promise<DynastyHistory | null>;
};

type MoveCheck = {
  movement: Movement;
  currentConference: string;
  state: 'verified' | 'pending' | 'mismatch';
};

const api = (window as unknown as { promoAPI: PromoApi }).promoAPI;
let lastSignature = '';
let enhancing = false;
let scheduled = false;

function esc(value: unknown): string {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
function isIndependent(value: string | null | undefined): boolean {
  return String(value ?? '').trim().toLowerCase().includes('independent');
}
function conferenceLabel(team: TeamSeason | undefined): string {
  if (!team) return 'Unknown';
  return isIndependent(team.conference) || isIndependent(team.conferenceEnum) ? 'Independent' : (team.conference ?? 'Unknown');
}
function seasonFor(history: DynastyHistory | null, year: number): StoredSeason | null {
  return history?.seasons.find((season) => season.seasonYear === year) ?? null;
}
function alignmentChanged(review: DynastySnapshot, latest: DynastySnapshot): boolean {
  for (const team of review.teams) {
    const current = latest.teams.find((item) => item.teamIndex === team.teamIndex);
    if (!current) continue;
    if (conferenceLabel(current) !== conferenceLabel(team)) return true;
  }
  return false;
}
function checkMovements(movements: Movement[], latest: DynastySnapshot): MoveCheck[] {
  return movements.map((movement) => {
    const team = latest.teams.find((item) => item.teamIndex === movement.teamIndex);
    const currentConference = conferenceLabel(team);
    const state: MoveCheck['state'] = currentConference === movement.toConference
      ? 'verified'
      : currentConference === movement.fromConference ? 'pending' : 'mismatch';
    return { movement, currentConference, state };
  });
}
function signature(review: DynastySnapshot, latest: DynastySnapshot, season: StoredSeason): string {
  return [
    review.dynastyId,
    review.seasonYear,
    review.importedAt,
    latest.importedAt,
    season.closed,
    season.reviewLockedAt ?? '',
    season.movements.map((move) => `${move.teamIndex}:${move.fromConference}:${move.toConference}`).join('|'),
  ].join('::');
}
function statusCopy(checks: MoveCheck[], changed: boolean): { tone: string; title: string; detail: string } {
  if (!checks.length) {
    if (changed) return {
      tone: 'warning',
      title: 'Failsafe active — review snapshot preserved',
      detail: 'The latest save has different conference membership. Recommendations below still use the locked offseason review snapshot.',
    };
    return {
      tone: 'ready',
      title: 'Offseason review snapshot locked',
      detail: 'You can make the conference changes in-game, save, then Sync again to verify them without changing this review.',
    };
  }

  const verified = checks.filter((check) => check.state === 'verified').length;
  const pending = checks.filter((check) => check.state === 'pending').length;
  const mismatch = checks.filter((check) => check.state === 'mismatch').length;
  if (verified === checks.length) return {
    tone: 'success',
    title: `Alignment verified — ${verified}/${checks.length} moves match`,
    detail: 'The latest synced game save matches every recorded promotion/relegation move for this season.',
  };
  if (mismatch) return {
    tone: 'warning',
    title: `Alignment check — ${verified} verified · ${pending} pending · ${mismatch} mismatch`,
    detail: 'The locked review is safe. Check the highlighted teams before advancing the dynasty.',
  };
  return {
    tone: 'ready',
    title: `Waiting for in-game changes — ${verified}/${checks.length} verified`,
    detail: `${pending} recorded move${pending === 1 ? '' : 's'} still show the original conference in the latest save.`,
  };
}

async function enhance(): Promise<void> {
  scheduled = false;
  if (enhancing) return;
  if (document.querySelector('#pageTitle')?.textContent?.trim() !== 'Promotion / Relegation') return;
  enhancing = true;
  try {
    const review = await api.getCurrentSnapshot();
    if (!review) return;
    const latest = await api.getLatestSnapshot() ?? review;
    const history = await api.getHistory(review.dynastyId);
    const season = seasonFor(history, review.seasonYear);
    if (!season || (!season.closed && !season.reviewLockedAt)) return;

    const nextSignature = signature(review, latest, season);
    const existing = document.querySelector<HTMLElement>('[data-review-verification]');
    if (nextSignature === lastSignature && existing) return;
    lastSignature = nextSignature;
    existing?.remove();

    const checks = checkMovements(season.movements, latest);
    const changed = alignmentChanged(review, latest);
    const copy = statusCopy(checks, changed);
    const unresolved = checks.filter((check) => check.state !== 'verified');
    const detailRows = unresolved.length
      ? `<div class="verification-items">${unresolved.map((check) => `<div class="verification-item ${check.state}"><span>${check.state === 'pending' ? '○' : '!'}</span><strong>${esc(check.movement.teamName)}</strong><small>${esc(check.movement.fromConference)} → ${esc(check.movement.toConference)} · latest: ${esc(check.currentConference)}</small></div>`).join('')}</div>`
      : '';

    const panel = document.createElement('section');
    panel.className = `review-verification ${copy.tone}`;
    panel.dataset.reviewVerification = '';
    panel.innerHTML = `<div class="verification-icon">${copy.tone === 'success' ? '✓' : copy.tone === 'warning' ? '!' : '◆'}</div><div class="verification-copy"><span class="verification-kicker">SYNC FAILSAFE</span><strong>${esc(copy.title)}</strong><p>${esc(copy.detail)}</p>${detailRows}</div><div class="verification-meta"><span>Review</span><b>${esc(review.seasonYear)}</b><small>${changed ? 'Latest alignment differs' : 'Alignment unchanged'}</small></div>`;

    const summary = document.querySelector<HTMLElement>('#content .summary');
    if (summary) summary.insertAdjacentElement('afterend', panel);
  } catch (error) {
    console.error('Review verification:', error);
  } finally {
    enhancing = false;
  }
}

function schedule(delay = 0): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => void enhance(), delay);
}

// Navigation and Sync replace #content. Observe only child-list changes and guard
// our own injected panel so this cannot become a self-triggering render loop.
const content = document.querySelector('#content');
if (content) new MutationObserver(() => schedule(20)).observe(content, { childList: true });
document.addEventListener('click', () => schedule(250));
setTimeout(() => schedule(), 150);

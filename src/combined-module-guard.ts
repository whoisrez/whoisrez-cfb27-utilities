let lastTeamNeedsStatus = '';

function isTeamNeedsPage(): boolean {
  return document.querySelector('#pageTitle')?.textContent?.trim() === 'Team Needs';
}

function protectTeamNeedsHeader(): void {
  if (!isTeamNeedsPage()) return;
  const subtitle = document.querySelector<HTMLElement>('#pageSubtitle');
  const status = document.querySelector<HTMLElement>('#status');
  if (subtitle && subtitle.textContent !== 'Weekly roster planning and committed-recruit tracking.') {
    subtitle.textContent = 'Weekly roster planning and committed-recruit tracking.';
  }
  if (!status) return;

  const text = status.textContent ?? '';
  const seasonCleanupText = text.includes('champions')
    || text.includes('Season open')
    || text.includes('Season closed')
    || text.includes('Latest alignment');

  if (!seasonCleanupText) {
    lastTeamNeedsStatus = status.innerHTML;
  } else if (lastTeamNeedsStatus && status.innerHTML !== lastTeamNeedsStatus) {
    status.innerHTML = lastTeamNeedsStatus;
  }
}

function protectCombinedPage(): void {
  protectTeamNeedsHeader();
}

const content = document.querySelector('#content');
if (content) new MutationObserver(protectCombinedPage).observe(content, { childList: true, subtree: true });

const status = document.querySelector('#status');
if (status) new MutationObserver(protectCombinedPage).observe(status, { childList: true, subtree: true, characterData: true });

const subtitle = document.querySelector('#pageSubtitle');
if (subtitle) new MutationObserver(protectCombinedPage).observe(subtitle, { childList: true, subtree: true, characterData: true });

document.addEventListener('click', () => {
  queueMicrotask(protectCombinedPage);
  setTimeout(protectCombinedPage, 5);
});
document.addEventListener('change', () => {
  queueMicrotask(protectCombinedPage);
  setTimeout(protectCombinedPage, 5);
});
protectCombinedPage();

import './history-collapse.css';

const collapsedYears = new Map<number, boolean>();
let historyKey = '';
let scheduled = false;

function currentHistoryKey(): string {
  const save = (document.querySelector('#status strong') as HTMLElement | null)?.textContent?.trim() ?? '';
  const years = Array.from(document.querySelectorAll('.history-season .year'))
    .map((node) => Number((node as HTMLElement).textContent))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)
    .join(',');
  return `${save}|${years}`;
}

function applyHistoryCollapse(): void {
  scheduled = false;
  if (document.querySelector('#pageTitle')?.textContent?.trim() !== 'History') return;

  const articles = Array.from(document.querySelectorAll('.history-season')) as HTMLElement[];
  if (!articles.length) return;

  const key = currentHistoryKey();
  if (key !== historyKey) {
    historyKey = key;
    collapsedYears.clear();
  }

  const years = articles
    .map((article) => Number(article.querySelector('.year')?.textContent))
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  const newestYear = years[0];

  for (const article of articles) {
    const year = Number(article.querySelector('.year')?.textContent);
    if (!Number.isFinite(year)) continue;

    if (!collapsedYears.has(year)) collapsedYears.set(year, year !== newestYear);
    const collapsed = collapsedYears.get(year) ?? false;

    const head = article.querySelector('.history-season-head') as HTMLElement | null;
    const edit = head?.querySelector('.history-edit') as HTMLButtonElement | null | undefined;
    let actions = (head?.querySelector('.history-season-actions') as HTMLElement | null | undefined) ?? null;
    if (head && edit && !actions) {
      actions = document.createElement('div');
      actions.className = 'history-season-actions';
      head.insertBefore(actions, edit);
      actions.appendChild(edit);
    }

    let toggle = (actions?.querySelector('.history-toggle') as HTMLButtonElement | null | undefined) ?? null;
    if (actions && !toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'secondary history-toggle';
      toggle.dataset.year = String(year);
      actions.insertBefore(toggle, actions.firstChild);
    }

    if (toggle) {
      const label = collapsed ? 'Expand' : 'Collapse';
      if (toggle.textContent !== label) toggle.textContent = label;
      const expanded = String(!collapsed);
      if (toggle.getAttribute('aria-expanded') !== expanded) toggle.setAttribute('aria-expanded', expanded);
    }

    article.classList.toggle('history-collapsed', collapsed);
    const grid = article.querySelector('.history-pair-grid') as HTMLElement | null;
    if (grid && grid.hidden !== collapsed) grid.hidden = collapsed;
  }
}

function scheduleApply(): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(applyHistoryCollapse, 0);
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  const toggle = target?.closest('.history-toggle') as HTMLButtonElement | null | undefined;
  if (toggle) {
    const year = Number(toggle.dataset.year);
    if (Number.isFinite(year)) {
      collapsedYears.set(year, !(collapsedYears.get(year) ?? false));
      applyHistoryCollapse();
      return;
    }
  }

  // Base renderer navigation and action handlers run before this document-level
  // handler, so a zero-delay apply sees the freshly rendered History page.
  scheduleApply();
});

// Initial pass for reloads that open on History.
setTimeout(scheduleApply, 100);

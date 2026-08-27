const promoContent = document.querySelector<HTMLElement>('#content');

function isPromotionPage(): boolean {
  return document.querySelector('#pageTitle')?.textContent?.trim() === 'Promotion / Relegation';
}

function unlockClosedMovementSelects(): void {
  if (!promoContent || !isPromotionPage()) return;
  const reopen = promoContent.querySelector<HTMLButtonElement>('#reopenBtn');
  if (!reopen) return;

  promoContent.querySelectorAll<HTMLSelectElement>('select[data-move]').forEach((select) => {
    select.disabled = false;
    select.dataset.autoReopen = 'true';
    select.title = 'Changing this selection will reopen the season for editing.';
  });

  const head = promoContent.querySelector<HTMLElement>('.panel-head');
  if (head && !head.querySelector('.closed-edit-note')) {
    const note = document.createElement('div');
    note.className = 'closed-edit-note';
    note.textContent = 'Closed · edit a selection to reopen';
    head.querySelector('.panel-actions')?.prepend(note);
  }
}

async function waitForSeasonReopen(): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (!promoContent?.querySelector('#reopenBtn') && promoContent?.querySelector('#closeBtn')) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  }
  return false;
}

document.addEventListener('change', async (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>('select[data-move][data-auto-reopen="true"]');
  if (!select || !isPromotionPage()) return;

  const card = select.closest<HTMLElement>('[data-pair]');
  const pairKey = card?.dataset.pair;
  const moveKind = select.dataset.move;
  const chosenValue = select.value;
  const reopen = promoContent?.querySelector<HTMLButtonElement>('#reopenBtn');
  if (!pairKey || !moveKind || !reopen) return;

  // The original renderer intentionally disables selects for closed seasons.
  // Stop that closed-state change from reaching its normal handler, reopen the
  // season through the existing safe workflow, then replay the user's choice.
  event.preventDefault();
  event.stopImmediatePropagation();

  reopen.click();
  const reopened = await waitForSeasonReopen();
  if (!reopened) return;

  const replacement = promoContent?.querySelector<HTMLSelectElement>(
    `[data-pair="${CSS.escape(pairKey)}"] select[data-move="${CSS.escape(moveKind)}"]`,
  );
  if (!replacement) return;
  replacement.value = chosenValue;
  replacement.dispatchEvent(new Event('change', { bubbles: true }));
}, true);

if (promoContent) {
  new MutationObserver(() => queueMicrotask(unlockClosedMovementSelects)).observe(promoContent, {
    childList: true,
    subtree: true,
  });
}

document.addEventListener('click', () => queueMicrotask(unlockClosedMovementSelects));
unlockClosedMovementSelects();

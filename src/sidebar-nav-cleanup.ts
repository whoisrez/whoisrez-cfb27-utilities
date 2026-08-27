const nav = document.querySelector<HTMLElement>('#nav');
if (nav) {
  const labels = Array.from(nav.querySelectorAll<HTMLElement>('.combined-nav-label'));
  const seasonLabel = labels.find((label) => label.textContent?.trim().toUpperCase() === 'SEASON');
  if (seasonLabel) seasonLabel.textContent = 'OFFSEASON';

  nav.querySelectorAll<HTMLButtonElement>('button > span').forEach((span) => span.remove());

  const toggle = nav.querySelector<HTMLButtonElement>('#seasonToggle');
  const subnav = nav.querySelector<HTMLElement>('#seasonNav');
  if (toggle && subnav) {
    const moduleHeader = document.createElement('div');
    moduleHeader.className = 'offseason-module-header';
    moduleHeader.textContent = 'Promotion / Relegation';
    toggle.replaceWith(moduleHeader);
    subnav.classList.add('open', 'offseason-subnav');
  }
}

// Static app layout. Everything inside #content, #status and the header text is
// re-rendered by app.ts; the elements here live for the whole session.

const SHELL = `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand"></div>
      <nav id="nav">
        <div class="combined-nav-label">RECRUITING</div>
        <button data-page="team-needs">Team Needs</button>
        <div class="combined-nav-label season-label">OFFSEASON</div>
        <div class="offseason-module-header">Promotion / Relegation</div>
        <div class="combined-subnav open offseason-subnav">
          <button data-page="dashboard">Dashboard</button>
          <button data-page="movement">Promotion / Relegation</button>
          <button data-page="alignment">Current Alignment</button>
          <button data-page="teams">Teams</button>
          <button data-page="conferences">Conferences</button>
          <button data-page="history">History</button>
        </div>
      </nav>
      <div class="sidebar-note">READ-ONLY GAME ACCESS<br><small>The tracker never edits CFB 27 saves.</small></div>
    </aside>
    <main class="workspace">
      <header class="topbar">
        <div>
          <div class="combined-title-row">
            <h1 id="pageTitle"></h1>
            <button id="syncBtn" class="secondary section-sync" type="button" disabled>Sync</button>
            <button id="teamNeedsSyncBtn" class="secondary section-sync" type="button" disabled hidden>Sync</button>
          </div>
          <p id="pageSubtitle"></p>
        </div>
        <div class="actions">
          <div class="team-needs-top-extras">
            <select id="teamNeedsTeamSelectTop" class="team-needs-top-select" aria-label="Team" hidden></select>
            <button id="teamNeedsResetBtnTop" class="secondary" type="button" hidden>Reset Manual Values</button>
          </div>
          <button id="globalImportBtn" class="primary" type="button">Import Dynasty</button>
        </div>
      </header>
      <div id="status" class="status"></div>
      <section id="content"></section>
    </main>
  </div>`;

function find<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`App shell is missing ${selector}.`);
  return element;
}

export function mountShell(root: HTMLElement) {
  root.innerHTML = SHELL;
  return {
    brand: find<HTMLElement>(root, '.brand'),
    nav: find<HTMLElement>(root, '#nav'),
    workspace: find<HTMLElement>(root, '.workspace'),
    title: find<HTMLElement>(root, '#pageTitle'),
    subtitle: find<HTMLElement>(root, '#pageSubtitle'),
    promoSync: find<HTMLButtonElement>(root, '#syncBtn'),
    teamNeedsSync: find<HTMLButtonElement>(root, '#teamNeedsSyncBtn'),
    teamSelect: find<HTMLSelectElement>(root, '#teamNeedsTeamSelectTop'),
    resetManual: find<HTMLButtonElement>(root, '#teamNeedsResetBtnTop'),
    importButton: find<HTMLButtonElement>(root, '#globalImportBtn'),
    status: find<HTMLElement>(root, '#status'),
    content: find<HTMLElement>(root, '#content'),
  };
}

export type Shell = ReturnType<typeof mountShell>;

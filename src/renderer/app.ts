// App state and event handling. All rendering goes through render(); pages are
// plain HTML builders in ./promotion/pages.ts and ./team-needs/page.ts.
import type { DynastySnapshot, PromoApi, StoredSeason, TeamNeedsApi, TeamNeedsDynasty } from '../shared/types';
import { createBrand } from './brand';
import { errorMessage, esc } from './html';
import {
  promoHeader, promoStatus, renderAlignment, renderConferenceHistory, renderConferences, renderDashboard,
  renderHistory, renderMovement, renderTeamHistory, renderTeams, type PromoPage,
} from './promotion/pages';
import {
  currentSeason, defaultDraft, draftsFromSeason, independentDraftFromSeason, movementPayload, PAIRS, seasonFor,
  type IndependentDraft, type Pair, type PairDraft, type PromoData,
} from './promotion/rules';
import { mountShell } from './shell';
import { chooseTeam, readManualRow, renderTeamNeeds, selectableTeams, teamOptions, TEAM_NEEDS_SUBTITLE, TEAM_NEEDS_TITLE } from './team-needs/page';
import { clearManualValues, loadNeedsOnly, rememberTeamIndex, saveManualValues, saveNeedsOnly } from './team-needs/storage';

type Page = 'team-needs' | PromoPage;

export function startApp(root: HTMLElement, promoApi: PromoApi, teamNeedsApi: TeamNeedsApi): void {
  const ui = mountShell(root);
  const brand = createBrand(ui.brand, teamNeedsApi);

  const state = {
    page: 'dashboard' as Page,
    // Promotion / Relegation
    promo: null as PromoData | null,
    drafts: new Map<string, PairDraft>(),
    independent: { toIndependent: null, fromIndependent: null, destinationConference: null } as IndependentDraft,
    independentKey: '',
    teamHistoryIndex: null as number | null,
    conferenceHistory: 'ACC',
    collapsed: new Map<number, boolean>(),
    collapsedKey: '',
    // Team Needs
    teamNeeds: null as TeamNeedsDynasty | null,
    teamIndex: null as number | null,
    needsOnly: loadNeedsOnly(),
    // One-off message (errors) shown in the status bar until the next render.
    statusMessage: null as string | null,
    importing: false,
    promoSyncing: false,
    teamNeedsSyncing: false,
  };

  // ---- Promotion data ------------------------------------------------------------

  const draftFor = (pair: Pair): PairDraft => {
    if (!state.promo) return { promote: null, relegate: null };
    let draft = state.drafts.get(pair.key);
    if (!draft) {
      draft = defaultDraft(state.promo, pair);
      state.drafts.set(pair.key, draft);
    }
    return draft;
  };

  /** Independent selections survive a Sync; they reset when the season is closed, reopened or changed. */
  function restoreIndependentDraft(): void {
    if (!state.promo) return;
    const season = currentSeason(state.promo);
    const key = [state.promo.review.dynastyId, state.promo.review.seasonYear, season?.closed ?? false, season?.closedAt ?? '', season?.reopenedAt ?? ''].join(':');
    if (key === state.independentKey) return;
    state.independentKey = key;
    state.independent = independentDraftFromSeason(season);
  }

  async function setPromoData(review: DynastySnapshot, latest?: DynastySnapshot | null): Promise<void> {
    const history = await promoApi.getHistory(review.dynastyId);
    const resolvedLatest = latest === undefined ? await promoApi.getLatestSnapshot() : latest;
    state.promo = { review, latest: resolvedLatest ?? review, history };
    state.drafts = draftsFromSeason(seasonFor(history, review.seasonYear));
    restoreIndependentDraft();
  }

  /** Reopen a closed season; its saved selections become editable drafts again. */
  async function reopenSeason(season: StoredSeason): Promise<void> {
    const promo = state.promo!;
    promo.history = await promoApi.reopenSeason(promo.history?.dynastyId ?? promo.review.dynastyId, season.seasonYear);
    const reopened = seasonFor(promo.history, season.seasonYear) ?? season;
    promo.review = reopened.snapshot;
    promo.latest = reopened.latestSnapshot ?? reopened.snapshot;
    state.drafts = draftsFromSeason(reopened);
    restoreIndependentDraft();
  }

  // ---- Team Needs data ----------------------------------------------------------------

  const currentTeam = () => state.teamNeeds?.teams.find((team) => team.teamIndex === state.teamIndex) ?? null;

  async function loadTeamNeeds(): Promise<void> {
    const loaded = await teamNeedsApi.sync();
    state.teamNeeds = loaded;
    state.teamIndex = chooseTeam(loaded, state.teamIndex);
    updateBrand();
  }

  function updateBrand(): void {
    const userTeams = state.teamNeeds?.teams.filter((team) => team.isUserControlled) ?? [];
    const pickerShown = state.page === 'team-needs' && selectableTeams(state.teamNeeds).length > 1;
    const team = (pickerShown ? userTeams.find((item) => item.teamIndex === state.teamIndex) : undefined) ?? userTeams[0];
    if (team) void brand.setTeam(team.teamName);
  }

  // ---- Rendering --------------------------------------------------------------------------

  function renderHeader(title: string, subtitle: string): void {
    ui.title.textContent = title;
    ui.subtitle.textContent = subtitle;
  }

  function renderNav(): void {
    ui.nav.querySelectorAll<HTMLButtonElement>('button[data-page]').forEach((button) => {
      button.classList.toggle('active', button.dataset.page === state.page);
    });
  }

  function renderTopbar(): void {
    const onTeamNeeds = state.page === 'team-needs';
    document.body.classList.toggle('team-needs-active', onTeamNeeds);
    ui.promoSync.hidden = onTeamNeeds;
    ui.promoSync.disabled = !state.promo || state.promoSyncing || state.importing;
    ui.promoSync.textContent = state.promoSyncing ? 'Syncing…' : 'Sync';
    ui.teamNeedsSync.hidden = !onTeamNeeds;
    ui.teamNeedsSync.disabled = !state.teamNeeds || state.teamNeedsSyncing;
    ui.teamNeedsSync.textContent = state.teamNeedsSyncing ? 'Syncing…' : 'Sync';
    ui.resetManual.hidden = !onTeamNeeds || !currentTeam();
    const showPicker = onTeamNeeds && selectableTeams(state.teamNeeds).length > 1;
    ui.teamSelect.hidden = !showPicker;
    if (showPicker) ui.teamSelect.innerHTML = teamOptions(state.teamNeeds, state.teamIndex);
    ui.importButton.disabled = state.importing;
    ui.importButton.textContent = state.importing ? 'Reading Save…' : 'Import Dynasty';
  }

  function renderPromoPage(page: PromoPage): string {
    const data = state.promo;
    switch (page) {
      case 'dashboard': return renderDashboard(data);
      case 'movement': return renderMovement(data, draftFor, state.independent);
      case 'alignment': return renderAlignment(data);
      case 'teams': {
        if (!data) return renderTeams(null, '');
        const teamHistory = renderTeamHistory(data, state.teamHistoryIndex);
        state.teamHistoryIndex = teamHistory.selectedIndex;
        return renderTeams(data, teamHistory.html);
      }
      case 'conferences': return renderConferences(data, data ? renderConferenceHistory(data, state.conferenceHistory) : '');
      case 'history': return renderHistory(data, isCollapsed);
    }
  }

  /** Newest season starts expanded and older ones collapsed; toggles persist until the history changes. */
  function isCollapsed(year: number): boolean {
    const seasons = state.promo?.history?.seasons ?? [];
    const years = seasons.map((season) => season.seasonYear).sort((a, b) => b - a);
    const key = `${state.promo?.review.dynastyId}|${years.join(',')}`;
    if (key !== state.collapsedKey) {
      state.collapsedKey = key;
      state.collapsed.clear();
    }
    if (!state.collapsed.has(year)) state.collapsed.set(year, year !== years[0]);
    return state.collapsed.get(year)!;
  }

  function render(): void {
    renderNav();
    renderTopbar();
    if (state.page === 'team-needs') {
      renderHeader(TEAM_NEEDS_TITLE, TEAM_NEEDS_SUBTITLE);
      const [status, content] = renderTeamNeeds(state.teamNeeds, currentTeam(), state.needsOnly);
      ui.status.innerHTML = state.statusMessage ?? status;
      ui.content.innerHTML = content;
    } else {
      renderHeader(...promoHeader(state.page, Boolean(state.promo)));
      ui.status.innerHTML = state.statusMessage ?? promoStatus(state.promo);
      ui.content.innerHTML = renderPromoPage(state.page);
    }
    state.statusMessage = null;
  }

  function showStatus(title: string, error: unknown, note: string): void {
    state.statusMessage = `<span><strong>${title}</strong> ${esc(errorMessage(error))}</span><span>${note}</span>`;
  }

  function go(page: Page): void {
    state.page = page;
    render();
  }

  // ---- Actions --------------------------------------------------------------------------------

  async function importDynasty(): Promise<void> {
    if (state.importing) return;
    const fromTeamNeeds = state.page === 'team-needs';
    const mask = fromTeamNeeds ? showImportMask() : null;
    state.importing = true;
    renderTopbar();
    try {
      const loaded = await promoApi.chooseAndLoad();
      if (!loaded) return;
      await setPromoData(loaded);
      if (!fromTeamNeeds) state.page = 'movement';
      try {
        await loadTeamNeeds();
      } catch (error) {
        if (fromTeamNeeds) showStatus('Team Needs load failed.', error, 'The Season import completed.');
      }
    } catch (error) {
      showStatus('Import failed.', error, 'Save was not modified.');
    } finally {
      state.importing = false;
      mask?.remove();
      document.body.classList.remove('shared-import-running');
      render();
    }
  }

  function showImportMask(): HTMLElement {
    const mask = document.createElement('div');
    mask.className = 'shared-import-mask';
    mask.innerHTML = '<div><strong>Importing Dynasty</strong><span>Loading the selected save for Team Needs and Season…</span></div>';
    ui.workspace.appendChild(mask);
    document.body.classList.add('shared-import-running');
    return mask;
  }

  async function syncPromo(): Promise<void> {
    if (!state.promo || state.promoSyncing) return;
    state.promoSyncing = true;
    renderTopbar();
    try {
      const loaded = await promoApi.syncCurrentSave();
      await setPromoData(loaded);
    } catch (error) {
      showStatus('Sync failed.', error, 'The last imported data is still shown.');
    } finally {
      state.promoSyncing = false;
      render();
    }
  }

  async function syncTeamNeeds(): Promise<void> {
    if (!state.teamNeeds || state.teamNeedsSyncing) return;
    state.teamNeedsSyncing = true;
    renderTopbar();
    try {
      await loadTeamNeeds();
    } catch (error) {
      showStatus('Team Needs sync failed.', error, 'Season data was not touched.');
    } finally {
      state.teamNeedsSyncing = false;
      render();
    }
  }

  async function closeSeason(): Promise<void> {
    const promo = state.promo;
    if (!promo) return;
    try {
      const movements = movementPayload(promo, draftFor, state.independent);
      promo.history = await promoApi.closeSeason(promo.review.dynastyId, promo.review.seasonYear, movements);
      restoreIndependentDraft();
    } catch (error) {
      showStatus('Could not close season.', error, 'Nothing was changed.');
    }
    render();
  }

  async function reopenCurrentSeason(): Promise<void> {
    const season = state.promo && currentSeason(state.promo);
    if (!season) return;
    await reopenSeason(season);
    render();
  }

  /** History → "Reopen & Edit" / "Edit Season": load that season into the review page. */
  async function editHistorySeason(year: number): Promise<void> {
    const promo = state.promo;
    const season = promo && seasonFor(promo.history, year);
    if (!promo || !season) return;
    if (season.closed) {
      await reopenSeason(season);
    } else {
      promo.review = season.snapshot;
      promo.latest = season.latestSnapshot ?? season.snapshot;
      state.drafts = draftsFromSeason(season);
      restoreIndependentDraft();
    }
    go('movement');
  }

  async function changeMovement(select: HTMLSelectElement): Promise<void> {
    const pairKey = select.closest<HTMLElement>('[data-pair]')?.dataset.pair;
    const pair = PAIRS.find((item) => item.key === pairKey);
    if (!pair || !state.promo) return;
    const value = select.value ? Number(select.value) : null;
    // Editing a closed season reopens it first, then applies the new choice.
    const season = currentSeason(state.promo);
    if (season?.closed) await reopenSeason(season);
    const draft = draftFor(pair);
    if (select.dataset.move === 'promote') draft.promote = value; else draft.relegate = value;
    render();
  }

  function changeIndependent(select: HTMLSelectElement): void {
    const value = select.value;
    const draft = state.independent;
    if (select.dataset.independent === 'to') draft.toIndependent = value ? Number(value) : null;
    if (select.dataset.independent === 'from') {
      draft.fromIndependent = value ? Number(value) : null;
      if (!draft.fromIndependent) draft.destinationConference = null;
    }
    if (select.dataset.independent === 'destination') draft.destinationConference = value || null;
    render();
  }

  function replacePanel(id: string, html: string): void {
    const panel = ui.content.querySelector<HTMLElement>(`#${id}`);
    if (panel) panel.innerHTML = html;
  }

  // ---- Events ------------------------------------------------------------------------------------

  ui.nav.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-page]');
    if (button?.dataset.page) {
      go(button.dataset.page as Page);
      if (state.page === 'team-needs') updateBrand();
    }
  });

  ui.importButton.addEventListener('click', () => void importDynasty());
  ui.promoSync.addEventListener('click', () => void syncPromo());
  ui.teamNeedsSync.addEventListener('click', () => void syncTeamNeeds());
  ui.resetManual.addEventListener('click', () => {
    clearManualValues(state.teamIndex);
    render();
  });
  ui.teamSelect.addEventListener('change', () => {
    const parsed = Number(ui.teamSelect.value);
    state.teamIndex = Number.isFinite(parsed) ? parsed : null;
    if (state.teamIndex != null) rememberTeamIndex(state.teamIndex);
    const team = currentTeam();
    if (team) void brand.setTeam(team.teamName);
    render();
  });

  ui.content.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    if (state.page === 'team-needs') {
      const row = target.closest<HTMLTableRowElement>('tr[data-target-group]');
      const edit = target.matches('input[data-manual-field]') && row ? readManualRow(row) : null;
      if (edit) {
        saveManualValues(state.teamIndex, edit.groupKey, edit.values);
        render();
      }
      return;
    }
    const select = target as HTMLSelectElement;
    if (select.matches('select[data-move]')) void changeMovement(select);
    else if (select.matches('select[data-independent]')) changeIndependent(select);
    else if (select.matches('[data-team-history]') && state.promo) {
      state.teamHistoryIndex = Number(select.value);
      replacePanel('teamHistoryPanel', renderTeamHistory(state.promo, state.teamHistoryIndex).html);
    } else if (select.matches('[data-conference-history]') && state.promo) {
      state.conferenceHistory = select.value;
      replacePanel('conferenceHistoryPanel', renderConferenceHistory(state.promo, state.conferenceHistory));
    }
  });

  ui.content.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const closest = (selector: string) => target.closest<HTMLElement>(selector);
    if (closest('#needsOnlyToggle')) {
      state.needsOnly = !state.needsOnly;
      saveNeedsOnly(state.needsOnly);
      render();
    } else if (closest('#resetRecBtn')) {
      state.drafts = new Map();
      render();
    } else if (closest('#closeBtn')) {
      void closeSeason();
    } else if (closest('#reopenBtn')) {
      void reopenCurrentSeason();
    } else if (closest('[data-dashboard-page]')) {
      go(closest('[data-dashboard-page]')!.dataset.dashboardPage as Page);
    } else if (closest('.history-toggle')) {
      const year = Number(closest('.history-toggle')!.dataset.year);
      state.collapsed.set(year, !isCollapsed(year));
      render();
    } else if (closest('.history-edit')) {
      void editHistorySeason(Number(closest('.history-edit')!.dataset.year));
    }
  });

  render();
}

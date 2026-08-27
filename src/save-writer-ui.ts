import type { DynastyHistory, DynastySnapshot, Movement, StoredSeason } from './types';

type ProbeResult = {
  outputPath: string;
  changedTables: number;
  changedFields: number;
};

type PromoApi = {
  getCurrentSnapshot: () => Promise<DynastySnapshot | null>;
  getHistory: (dynastyId: string) => Promise<DynastyHistory | null>;
  probeConferenceDiff: (currentFilePath: string) => Promise<ProbeResult | null>;
};

const api = (window as unknown as { promoAPI: PromoApi }).promoAPI;
let enhancing = false;

function pairedMovements(season: StoredSeason): Movement[] {
  return season.movements.filter((movement) => movement.pairKey !== 'independent' && (movement.kind === 'promotion' || movement.kind === 'relegation'));
}

async function enhance(): Promise<void> {
  if (enhancing) return;
  if (document.querySelector('#pageTitle')?.textContent?.trim() !== 'Promotion / Relegation') return;
  enhancing = true;
  try {
    const actions = document.querySelector<HTMLElement>('.panel-actions');
    if (!actions) return;
    const current = await api.getCurrentSnapshot();
    if (!current) return;
    const history = await api.getHistory(current.dynastyId);
    const season = history?.seasons.find((item) => item.seasonYear === current.seasonYear);
    if (!season?.closed || !pairedMovements(season).length) return;

    const sidebar = document.querySelector<HTMLElement>('.sidebar-note');
    if (sidebar) sidebar.innerHTML = 'READ-ONLY BY DEFAULT<br><small>Writer calibration is in progress. No automatic save overwrite is enabled right now.</small>';

    let writer = actions.querySelector<HTMLButtonElement>('[data-save-writer]');
    if (!writer) {
      writer = document.createElement('button');
      writer.className = 'primary';
      writer.dataset.saveWriter = '';
      actions.append(writer);
    }
    writer.disabled = true;
    writer.textContent = 'Writer Calibration Needed';
    writer.title = 'Automatic writing is temporarily disabled until the game-authoritative conference fields are identified.';

    let probe = actions.querySelector<HTMLButtonElement>('[data-conference-probe]');
    if (!probe) {
      probe = document.createElement('button');
      probe.className = 'secondary';
      probe.dataset.conferenceProbe = '';
      probe.textContent = 'Compare Manual Move';
      actions.prepend(probe);
    }

    if (probe.dataset.bound === '1') return;
    probe.dataset.bound = '1';
    probe.addEventListener('click', async () => {
      const fresh = await api.getCurrentSnapshot();
      if (!fresh) return;
      const confirmed = window.confirm(
        'CONFERENCE SAVE PROBE\n\nThis does NOT modify either save.\n\nYou will select two files:\n1. BEFORE — a save before one manual conference move in CFB 27.\n2. AFTER — the same dynasty after making that one move in-game and saving.\n\nThe tracker will compare every changed franchise table and write conference-diff.json.\n\nContinue?',
      );
      if (!confirmed) return;

      const oldText = probe!.textContent ?? 'Compare Manual Move';
      probe!.disabled = true;
      probe!.textContent = 'Comparing Saves…';
      try {
        const result = await api.probeConferenceDiff(fresh.filePath);
        if (!result) return;
        const status = document.querySelector<HTMLElement>('#status');
        if (status) {
          status.innerHTML = `<span><strong>Conference probe complete.</strong> ${result.changedTables} changed tables · ${result.changedFields} changed fields.</span><span>Output: ${result.outputPath}</span>`;
        }
        window.alert(`Conference save comparison complete.\n\nChanged tables: ${result.changedTables}\nChanged fields: ${result.changedFields}\n\nUpload this file to the chat:\n${result.outputPath}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        window.alert(`Conference save comparison failed.\n\n${message}`);
      } finally {
        probe!.disabled = false;
        probe!.textContent = oldText;
      }
    });
  } catch (error) {
    console.error('Save writer probe UI:', error);
  } finally {
    enhancing = false;
  }
}

function schedule(delay = 0): void {
  setTimeout(() => void enhance(), delay);
}

const content = document.querySelector('#content');
if (content) new MutationObserver(() => schedule(30)).observe(content, { childList: true, subtree: false });
document.addEventListener('click', () => schedule(250));
setTimeout(() => schedule(), 250);

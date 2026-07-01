import type { MessageType, ScanResult } from '../shared/types';

const lastScanEl = document.getElementById('last-scan')!;
const lastMatchesEl = document.getElementById('last-matches')!;
const scanAfterEl = document.getElementById('scan-after')!;
const scanningRow = document.getElementById('scanning-row')!;
const progressText = document.getElementById('progress-text')!;
const progressBar = document.getElementById('progress-bar')!;
const progressFill = document.getElementById('progress-fill')!;
const errorMsg = document.getElementById('error-msg')!;
const doneMsg = document.getElementById('done-msg')!;
const btnScanCurrent = document.getElementById('btn-scan-current') as HTMLButtonElement;
const btnScanAll = document.getElementById('btn-scan-all') as HTMLButtonElement;
const btnStopScan = document.getElementById('btn-stop-scan') as HTMLButtonElement;
const linkOptions = document.getElementById('link-options') as HTMLAnchorElement;

let stopRequested = false;

function formatDate(iso?: string): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString();
}

function setScanning(scanning: boolean): void {
  btnScanCurrent.disabled = scanning;
  btnScanAll.disabled = scanning;
  btnStopScan.hidden = !scanning;
  scanningRow.hidden = !scanning;
  progressBar.hidden = !scanning;
  if (!scanning) {
    btnStopScan.disabled = false;
    stopRequested = false;
  }
}

function showError(msg: string): void {
  errorMsg.textContent = msg;
  errorMsg.hidden = !msg;
}

function showDone(msg: string): void {
  doneMsg.textContent = msg;
  doneMsg.hidden = !msg;
}

function showStopped(matchCount = 0): void {
  setScanning(false);
  showError('');
  showDone(
    matchCount === 0
      ? 'Scan stopped.'
      : `Scan stopped — ${matchCount} match${matchCount === 1 ? '' : 'es'} found before stop.`,
  );
}

async function refreshState(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' } satisfies MessageType);
  if (!response || response.type !== 'STATE') return;

  const { state, config } = response;
  lastScanEl.textContent = formatDate(state.lastScanAt);
  lastMatchesEl.textContent = String(state.lastMatchCount);
  scanAfterEl.textContent = config.scanAfterDate ?? 'All dates';

  if (state.isScanning && state.progress && !stopRequested) {
    setScanning(true);
    progressText.textContent = state.progress.message;
    const pct = (state.progress.current / state.progress.total) * 100;
    progressFill.style.width = `${pct}%`;
  } else if (!stopRequested) {
    setScanning(false);
  }
}

async function runScanAndWait(
  message: Extract<MessageType, { type: 'SCAN_NOW' } | { type: 'SCAN_CURRENT_TAB' }>,
): Promise<void> {
  showError('');
  showDone('');
  stopRequested = false;
  setScanning(true);

  try {
    const result = (await chrome.runtime.sendMessage(message)) as ScanResult | undefined;

    if (stopRequested) return;

    if (result?.stopped) {
      showStopped(result.matchCount);
      await refreshState();
      return;
    }

    if (result?.started) {
      return;
    }

    setScanning(false);

    if (!result) {
      showError('Scan failed — no response from background');
      return;
    }

    if (result.error) {
      showError(result.error);
      return;
    }

    const count = result.matchCount;
    showDone(
      count === 0
        ? 'Scan complete — no new matches.'
        : `Scan complete — ${count} new match${count === 1 ? '' : 'es'} found.`,
    );
    await refreshState();
  } catch {
    if (!stopRequested) {
      setScanning(false);
      showError('Scan failed');
    }
  }
}

function startScan(
  message: Extract<MessageType, { type: 'SCAN_NOW' } | { type: 'SCAN_CURRENT_TAB' }>,
): void {
  void runScanAndWait(message);
}

btnScanCurrent.addEventListener('click', () => {
  startScan({ type: 'SCAN_CURRENT_TAB' });
});

btnScanAll.addEventListener('click', () => {
  startScan({ type: 'SCAN_NOW' });
});

btnStopScan.addEventListener('click', () => {
  stopRequested = true;
  showStopped(0);

  chrome.runtime.sendMessage({ type: 'STOP_SCAN' } satisfies MessageType)
    .then((result: ScanResult | undefined) => {
      if (result?.stopped) {
        showStopped(result.matchCount);
      }
      refreshState();
    })
    .catch(() => {
      showError('Failed to stop scan');
      stopRequested = false;
      setScanning(true);
    });
});

linkOptions.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message: MessageType) => {
  if (message.type === 'SCAN_PROGRESS' && message.progress && !stopRequested) {
    setScanning(true);
    btnStopScan.disabled = false;
    showDone('');
    progressText.textContent = message.progress.message;
    const pct = (message.progress.current / message.progress.total) * 100;
    progressFill.style.width = `${pct}%`;
  }

  if (message.type === 'SCAN_DONE') {
    stopRequested = false;
    if (message.error === 'Scan stopped') {
      showStopped(message.matchCount);
    } else {
      setScanning(false);
      if (message.error) {
        showError(message.error);
      } else {
        const count = message.matchCount;
        showDone(
          count === 0
            ? 'Scan complete — no new matches.'
            : `Scan complete — ${count} new match${count === 1 ? '' : 'es'} found.`,
        );
      }
    }
    refreshState();
  }
});

refreshState();

import { ensureKeepAlive, stopKeepAlive, tickKeepAlive } from './keep-alive.ts';
import { downloadPosts } from '../shared/export';
import {
  addSeenIds,
  getConfig,
  getScanState,
  getSeenIdsForGroup,
  saveScanState,
} from '../shared/storage';
import {
  clearScanQueue,
  createScanQueue,
  getScanQueue,
  markScanQueueStopped,
  pickScanBatch,
  saveScanQueue,
  SCAN_STEP_ALARM,
  SCAN_KEEPALIVE_ALARM,
  type ScanQueue,
} from '../shared/scan-queue';
import {
  hasTelegramConfig,
  sendPostToTelegram,
  sendTelegramTest,
} from '../shared/telegram-client';
import {
  ALARM_NAME,
  type GroupConfig,
  type MessageType,
  type ScannerConfig,
  type ScrapedPost,
  type ScanResult,
} from '../shared/types';

const TAB_LOAD_TIMEOUT_MS = 30_000;
const BETWEEN_GROUPS_DELAY_MS = 3000;
const TELEGRAM_SEND_DELAY_MS = 500;
const CANCEL_POLL_MS = 50;

let scanCancelled = false;
let scanAlreadyFinalized = false;
let stepProcessing = false;
const activeScanTabIds = new Set<number>();
const ownedScanTabIds = new Set<number>();
const activeScanTotals = { totalNew: 0, totalTelegramSent: 0 };

const LOG_PREFIX = '[FB Scanner]';

function log(stage: string, detail?: string | Record<string, unknown>): void {
  if (detail === undefined) {
    console.log(`${LOG_PREFIX} ${stage}`);
    return;
  }
  if (typeof detail === 'string') {
    console.log(`${LOG_PREFIX} ${stage} — ${detail}`);
    return;
  }
  console.log(`${LOG_PREFIX} ${stage}`, detail);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function interruptibleSleep(ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += CANCEL_POLL_MS) {
    if (await shouldStopScan()) return;
    await sleep(Math.min(CANCEL_POLL_MS, ms - elapsed));
  }
}

async function shouldStopScan(): Promise<boolean> {
  if (scanCancelled || scanAlreadyFinalized) return true;
  const queue = await getScanQueue();
  return Boolean(queue?.stopped);
}

function isScanStopRequested(): boolean {
  return scanCancelled || scanAlreadyFinalized;
}

function resetScanSession(): void {
  scanCancelled = false;
  scanAlreadyFinalized = false;
  stepProcessing = false;
  activeScanTabIds.clear();
  ownedScanTabIds.clear();
  activeScanTotals.totalNew = 0;
  activeScanTotals.totalTelegramSent = 0;
}

function syncTotalsFromQueue(queue: ScanQueue): void {
  activeScanTotals.totalNew = queue.totalNew;
  activeScanTotals.totalTelegramSent = queue.totalTelegramSent;
}

function trackScanTab(tabId: number, owned = true): void {
  activeScanTabIds.add(tabId);
  if (owned) ownedScanTabIds.add(tabId);
}

function untrackScanTab(tabId: number): void {
  activeScanTabIds.delete(tabId);
  ownedScanTabIds.delete(tabId);
}

function broadcastProgress(progress: { current: number; total: number; message: string }): void {
  if (scanAlreadyFinalized) return;
  chrome.runtime.sendMessage({
    type: 'SCAN_PROGRESS',
    progress,
  } satisfies MessageType).catch(() => undefined);
}

async function updateScanProgress(
  current: number,
  total: number,
  message: string,
  groupName?: string,
): Promise<void> {
  const progress = { current, total, message };
  await saveScanState({ currentGroup: groupName, progress });
  broadcastProgress(progress);
}

function broadcastDone(matchCount: number, error?: string): void {
  chrome.runtime.sendMessage({
    type: 'SCAN_DONE',
    matchCount,
    error,
  } satisfies MessageType).catch(() => undefined);
}

function notifyScanComplete(
  matchCount: number,
  options: { error?: string; telegramSent?: number; stopped?: boolean } = {},
): void {
  const { error, telegramSent = 0, stopped = false } = options;
  let message: string;

  if (stopped) {
    message = `Scan stopped. ${matchCount} new match${matchCount === 1 ? '' : 'es'} found before stop.`;
  } else if (error) {
    message = `Scan failed: ${error}`;
  } else if (matchCount === 0) {
    message = 'Scan complete — no new matches found.';
  } else {
    const parts = [`Scan complete — ${matchCount} new match${matchCount === 1 ? '' : 'es'} found.`];
    if (telegramSent > 0) {
      parts.push(`${telegramSent} sent to Telegram.`);
    }
    message = parts.join(' ');
  }

  try {
    chrome.notifications.create(`scan-done-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon.svg'),
      title: 'FB Group Scanner',
      message,
    });
  } catch {
    // notifications optional
  }
}

function cancelContentScriptOnTab(tabId: number): void {
  chrome.tabs.sendMessage(tabId, { type: 'CANCEL_SCAN' } satisfies MessageType).catch(() => undefined);
}

function closeOwnedScanTabs(): void {
  for (const tabId of [...ownedScanTabIds]) {
    untrackScanTab(tabId);
    chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

async function scheduleScanStep(delayMs: number): Promise<void> {
  await chrome.alarms.clear(SCAN_STEP_ALARM);
  chrome.alarms.create(SCAN_STEP_ALARM, { when: Date.now() + delayMs });
  log('Scan queue', `next step in ${delayMs}ms`);
}

async function stopActiveScan(): Promise<ScanResult> {
  const queue = await getScanQueue();
  const matchCount = queue?.totalNew ?? activeScanTotals.totalNew;
  const telegramSent = queue?.totalTelegramSent ?? activeScanTotals.totalTelegramSent;

  if (scanAlreadyFinalized) {
    return { ok: false, matchCount, error: 'Scan stopped', stopped: true };
  }

  scanCancelled = true;
  log('Stop scan', 'requested');

  await markScanQueueStopped();
  await chrome.alarms.clear(SCAN_STEP_ALARM);

  closeOwnedScanTabs();

  for (const tabId of [...activeScanTabIds]) {
    cancelContentScriptOnTab(tabId);
  }

  return finalizeScan(matchCount, {
    stopped: true,
    telegramSent,
  });
}

async function syncAlarm(config: ScannerConfig): Promise<void> {
  await chrome.alarms.clear(ALARM_NAME);
  if (config.schedule.enabled && config.schedule.intervalMinutes > 0) {
    await chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: config.schedule.intervalMinutes,
    });
  }
}

async function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearInterval(cancelPoll);
      reject(new Error('Tab load timeout'));
    }, TAB_LOAD_TIMEOUT_MS);

    const cancelPoll = setInterval(() => {
      if (isScanStopRequested()) {
        clearTimeout(timeout);
        clearInterval(cancelPoll);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }, CANCEL_POLL_MS);

    function listener(id: number, info: chrome.tabs.TabChangeInfo): void {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        clearInterval(cancelPoll);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function waitForContentScript(tabId: number): Promise<void> {
  log('Content script', `waiting on tab ${tabId}`);
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await shouldStopScan()) return;
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      log('Content script', `ready on tab ${tabId} (attempt ${attempt + 1})`);
      return;
    } catch {
      await interruptibleSleep(1000);
    }
  }
  if (!(await shouldStopScan())) {
    throw new Error('Content script not available on tab');
  }
}

async function waitUntilScanCancelled(): Promise<{ cancelled: true }> {
  while (!(await shouldStopScan())) {
    await sleep(CANCEL_POLL_MS);
  }
  return { cancelled: true };
}

async function scanTab(
  tabId: number,
  config: ScannerConfig,
  group: GroupConfig,
): Promise<ScrapedPost[]> {
  if (await shouldStopScan()) return [];

  log('Scan tab', { tabId, group: group.name });
  await waitForContentScript(tabId);
  if (await shouldStopScan()) return [];

  log('Scan tab', 'waiting 1.5s before content script scan');
  await interruptibleSleep(1500);
  if (await shouldStopScan()) return [];

  try {
    log('Scan tab', `sending SCAN_GROUP to tab ${tabId}`);
    const response = await Promise.race([
      chrome.tabs.sendMessage(tabId, {
        type: 'SCAN_GROUP',
        config,
        group,
      } satisfies MessageType),
      waitUntilScanCancelled(),
    ]);

    if ('cancelled' in response || (await shouldStopScan())) {
      log('Scan tab', 'cancelled');
      return [];
    }

    if (!response?.success) {
      if (response?.cancelled || (await shouldStopScan())) return [];
      throw new Error(response?.error ?? 'Content script scan failed');
    }

    const matches = (response.matches as ScrapedPost[]) ?? [];
    log('Scan tab', `${matches.length} match(es) from ${group.name}`);
    return matches;
  } catch {
    if (await shouldStopScan()) return [];
    throw new Error('Content script scan failed');
  }
}

async function openGroupTab(group: GroupConfig): Promise<number | null> {
  if (await shouldStopScan()) return null;

  log('Open tab', group.url);
  const tab = await chrome.tabs.create({ url: group.url, active: false });
  if (!tab.id) throw new Error('Failed to create tab');
  trackScanTab(tab.id);
  await waitForTabLoad(tab.id);
  if (await shouldStopScan()) return null;
  log('Open tab', `loaded tab ${tab.id} for ${group.name}`);
  return tab.id;
}

async function closeScanTab(tabId: number): Promise<void> {
  const owned = ownedScanTabIds.has(tabId);
  untrackScanTab(tabId);
  if (!owned) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // tab may already be closed
  }
}

async function sendMatchesToTelegram(
  posts: ScrapedPost[],
  config: ScannerConfig,
  onProgress?: (sent: number, total: number) => void,
): Promise<number> {
  if (!hasTelegramConfig(config)) return 0;

  const { botToken, chatId } = config.telegram;
  let sent = 0;

  log('Telegram', `sending ${posts.length} new post(s)`);

  for (const post of posts) {
    if (await shouldStopScan()) break;
    try {
      await sendPostToTelegram(botToken, chatId, post);
      sent++;
      onProgress?.(sent, posts.length);
      log('Telegram', `sent ${sent}/${posts.length} — post ${post.id}`);
      await interruptibleSleep(TELEGRAM_SEND_DELAY_MS);
    } catch (err) {
      console.error(`${LOG_PREFIX} Telegram send failed for post`, post.id, err);
    }
  }

  log('Telegram', `done — ${sent}/${posts.length} sent`);
  return sent;
}

async function processMatches(
  matches: ScrapedPost[],
  config: ScannerConfig,
  group: GroupConfig,
  progress?: { current: number; total: number },
): Promise<{ newCount: number; telegramSent: number }> {
  if (await shouldStopScan()) return { newCount: 0, telegramSent: 0 };

  log('Process matches', `${matches.length} match(es) for ${group.name}`);

  const state = await getScanState();
  const seen = getSeenIdsForGroup(state, group.id);
  const newPosts = matches.filter((p) => !seen.has(p.id));
  const skipped = matches.length - newPosts.length;

  if (!newPosts.length) {
    log('Process matches', `0 new (${skipped} already seen)`);
    return { newCount: 0, telegramSent: 0 };
  }

  log('Process matches', {
    new: newPosts.length,
    skippedSeen: skipped,
    telegram: hasTelegramConfig(config),
    export: config.export.enabled,
  });

  const reportSubProgress = (message: string): void => {
    if (!progress) return;
    void updateScanProgress(progress.current, progress.total, message, group.name);
  };

  reportSubProgress(`Sending to Telegram (0/${newPosts.length}) — ${group.name}`);

  const telegramSent = await sendMatchesToTelegram(newPosts, config, (sent, total) => {
    reportSubProgress(`Sending to Telegram (${sent}/${total}) — ${group.name}`);
  });

  if (!(await shouldStopScan()) && config.export.enabled) {
    reportSubProgress(`Exporting ${newPosts.length} post(s) — ${group.name}`);
    log('Export', `downloading ${newPosts.length} post(s) as ${config.export.format}`);
    await downloadPosts(newPosts, config.export.format, group.name);
  }

  if (!(await shouldStopScan())) {
    const updatedSeen = addSeenIds(state, group.id, newPosts.map((p) => p.id));
    await saveScanState({ seenPostIds: updatedSeen });
  }

  return { newCount: newPosts.length, telegramSent };
}

async function ensureNotScanning(): Promise<boolean> {
  const [state, queue] = await Promise.all([getScanState(), getScanQueue()]);
  if (queue?.active && !queue.stopped) return false;
  return !state.isScanning;
}

function stoppedScanResult(matchCount = activeScanTotals.totalNew): ScanResult {
  return {
    ok: false,
    matchCount,
    error: 'Scan stopped',
    stopped: true,
  };
}

async function finalizeScan(
  totalNew: number,
  options: { stopped?: boolean; telegramSent?: number; error?: string } = {},
): Promise<ScanResult> {
  if (scanAlreadyFinalized) {
    return options.stopped || scanCancelled
      ? stoppedScanResult(totalNew)
      : { ok: !options.error, matchCount: totalNew, error: options.error };
  }

  scanAlreadyFinalized = true;
  const { stopped = false, telegramSent = 0, error } = options;

  log('Scan finished', {
    totalNew,
    telegramSent,
    stopped,
    error: error ?? null,
  });

  await chrome.alarms.clear(SCAN_STEP_ALARM);
  await clearScanQueue();
  await stopKeepAlive();

  await saveScanState({
    isScanning: false,
    lastScanAt: new Date().toISOString(),
    lastMatchCount: totalNew,
    currentGroup: undefined,
    progress: undefined,
  });

  activeScanTabIds.clear();
  ownedScanTabIds.clear();
  scanCancelled = false;
  stepProcessing = false;

  if (stopped) {
    broadcastDone(totalNew, 'Scan stopped');
    notifyScanComplete(totalNew, { stopped: true, telegramSent });
    return stoppedScanResult(totalNew);
  }

  if (error) {
    broadcastDone(0, error);
    notifyScanComplete(0, { error });
    return { ok: false, matchCount: totalNew, error };
  }

  broadcastDone(totalNew);
  notifyScanComplete(totalNew, { telegramSent });
  return { ok: true, matchCount: totalNew };
}

async function startScanQueue(
  groups: GroupConfig[],
  options: { mode?: ScanQueue['mode']; activeTabId?: number } = {},
): Promise<ScanResult> {
  if (!groups.length) {
    return finalizeScan(0, { error: 'No groups configured' });
  }

  if (!(await ensureNotScanning())) {
    const error = 'A scan is already running';
    broadcastDone(0, error);
    return { ok: false, matchCount: 0, error };
  }

  resetScanSession();

  const config = await getConfig();
  const concurrency = options.mode === 'current_tab' ? 1 : config.scanBehavior.scanConcurrency;
  const queue = createScanQueue(groups, { ...options, concurrency });
  await saveScanQueue(queue);

  log('Run scan', `${groups.length} group(s) — queued (concurrency ${concurrency})`);

  await saveScanState({
    isScanning: true,
    progress: { current: 0, total: groups.length, message: 'Starting scan...' },
  });
  broadcastProgress({ current: 0, total: groups.length, message: 'Starting scan...' });

  await ensureKeepAlive();
  await scheduleScanStep(0);

  return { ok: true, matchCount: 0, started: true };
}

interface SingleGroupResult {
  newCount: number;
  telegramSent: number;
}

async function scanSingleGroup(
  group: GroupConfig,
  config: ScannerConfig,
  queue: ScanQueue,
  stepIndex: number,
  total: number,
): Promise<SingleGroupResult> {
  if (await shouldStopScan()) return { newCount: 0, telegramSent: 0 };

  log('Run scan', `group ${stepIndex}/${total}: ${group.name}`);

  let tabId: number | undefined;
  try {
    if (queue.mode === 'current_tab' && queue.activeTabId) {
      tabId = queue.activeTabId;
      trackScanTab(tabId, false);
    } else {
      const opened = await openGroupTab(group);
      if (opened == null || (await shouldStopScan())) {
        return { newCount: 0, telegramSent: 0 };
      }
      tabId = opened;
    }

    const matches = await scanTab(tabId, config, group);
    if (await shouldStopScan()) return { newCount: 0, telegramSent: 0 };

    return await processMatches(matches, config, group, {
      current: stepIndex,
      total,
    });
  } catch (err) {
    if (!(await shouldStopScan())) {
      console.error(`${LOG_PREFIX} Scan failed for ${group.name}:`, err);
    }
    return { newCount: 0, telegramSent: 0 };
  } finally {
    if (tabId) {
      await closeScanTab(tabId);
    }
  }
}

async function processScanStep(): Promise<void> {
  if (stepProcessing) {
    log('Scan queue', 'step already running — skip');
    return;
  }

  const queue = await getScanQueue();
  if (!queue?.active || queue.stopped) {
    log('Scan queue', 'no active queue');
    await stopKeepAlive();
    return;
  }

  if (scanAlreadyFinalized) return;

  stepProcessing = true;
  syncTotalsFromQueue(queue);
  scanCancelled = queue.stopped;

  try {
    await ensureKeepAlive();

    if (queue.currentIndex >= queue.groups.length) {
      await finalizeScan(queue.totalNew, {
        stopped: queue.stopped,
        telegramSent: queue.totalTelegramSent,
      });
      return;
    }

    const config = await getConfig();
    const total = queue.groups.length;
    const batch = pickScanBatch(queue.groups, queue.currentIndex, queue.concurrency);
    const batchLabel = batch.map((g) => g.name).join(', ');
    const completedAfterBatch = Math.min(queue.currentIndex + batch.length, total);

    log('Run scan', `batch ${queue.currentIndex + 1}-${completedAfterBatch}/${total}: ${batchLabel}`);
    await updateScanProgress(
      completedAfterBatch,
      total,
      `Scanning ${batch.length} group(s): ${batchLabel}...`,
      batchLabel,
    );

    const results = await Promise.all(
      batch.map((group, offset) =>
        scanSingleGroup(group, config, queue, queue.currentIndex + offset + 1, total),
      ),
    );

    queue.totalNew += results.reduce((sum, r) => sum + r.newCount, 0);
    queue.totalTelegramSent += results.reduce((sum, r) => sum + r.telegramSent, 0);

    const latest = await getScanQueue();
    if (!latest?.active || latest.stopped || (await shouldStopScan())) {
      if (latest && !scanAlreadyFinalized) {
        await finalizeScan(latest.totalNew, {
          stopped: true,
          telegramSent: latest.totalTelegramSent,
        });
      }
      return;
    }

    latest.totalNew = queue.totalNew;
    latest.totalTelegramSent = queue.totalTelegramSent;
    latest.currentIndex += batch.length;
    await saveScanQueue(latest);
    syncTotalsFromQueue(latest);

    if (latest.currentIndex >= latest.groups.length) {
      await finalizeScan(latest.totalNew, {
        telegramSent: latest.totalTelegramSent,
      });
      return;
    }

    await updateScanProgress(
      latest.currentIndex,
      total,
      `Completed ${latest.currentIndex}/${total} groups`,
    );
    await scheduleScanStep(BETWEEN_GROUPS_DELAY_MS);
  } finally {
    stepProcessing = false;
  }
}

async function resumeScanIfNeeded(): Promise<void> {
  const [state, queue] = await Promise.all([getScanState(), getScanQueue()]);

  if (queue?.active && !queue.stopped) {
    log('Resume scan', `from group ${queue.currentIndex + 1}/${queue.groups.length} (concurrency ${queue.concurrency})`);
    syncTotalsFromQueue(queue);
    scanAlreadyFinalized = false;
    await saveScanState({ isScanning: true });
    await ensureKeepAlive();
    await scheduleScanStep(500);
    return;
  }

  if (queue?.stopped) {
    await clearScanQueue();
    await stopKeepAlive();
  }

  if (state.isScanning && !queue?.active) {
    log('Resume scan', 'reset stale isScanning flag');
    await saveScanState({ isScanning: false, progress: undefined, currentGroup: undefined });
  }
}

function startBackgroundScan(task: () => Promise<ScanResult>): void {
  task().catch((err) => {
    if (scanAlreadyFinalized) return;
    console.error('Background scan error:', err);
    resetScanSession();
    void clearScanQueue();
    void stopKeepAlive();
    void saveScanState({ isScanning: false, progress: undefined });
    const message = err instanceof Error ? err.message : 'Scan failed';
    broadcastDone(0, message);
    notifyScanComplete(0, { error: message });
  });
}

chrome.runtime.onMessage.addListener((message: MessageType, _sender, sendResponse) => {
  switch (message.type) {
    case 'SCAN_NOW': {
      (async () => {
        const config = await getConfig();
        const groups = message.groupUrl
          ? config.groups.filter((g) => g.url === message.groupUrl)
          : config.groups;
        const result = await startScanQueue(groups);
        sendResponse(result);
      })();
      return true;
    }
    case 'SCAN_CURRENT_TAB': {
      (async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !tab.url?.includes('facebook.com/groups/')) {
          sendResponse(await finalizeScan(0, { error: 'Active tab is not a Facebook group page' }));
          return;
        }

        const groupIdMatch = tab.url.match(/groups\/([^/?#]+)/);
        if (!groupIdMatch) {
          sendResponse(await finalizeScan(0, { error: 'Could not parse group from URL' }));
          return;
        }

        const group: GroupConfig = {
          id: groupIdMatch[1],
          name: tab.title?.replace(/ \| Facebook$/, '') ?? groupIdMatch[1],
          url: tab.url.split('?')[0],
        };

        const result = await startScanQueue([group], {
          mode: 'current_tab',
          activeTabId: tab.id,
        });
        sendResponse(result);
      })();
      return true;
    }
    case 'STOP_SCAN': {
      stopActiveScan()
        .then((result) => sendResponse(result))
        .catch(() => sendResponse(stoppedScanResult()));
      return true;
    }
    case 'GET_STATE': {
      Promise.all([getScanState(), getConfig()]).then(([state, config]) => {
        sendResponse({ type: 'STATE', state, config } satisfies MessageType);
      });
      return true;
    }
    case 'TEST_TELEGRAM': {
      sendTelegramTest(message.botToken, message.chatId)
        .then(() => {
          sendResponse({ type: 'TEST_TELEGRAM_RESULT', success: true } satisfies MessageType);
        })
        .catch((err) => {
          sendResponse({
            type: 'TEST_TELEGRAM_RESULT',
            success: false,
            error: err instanceof Error ? err.message : 'Test failed',
          } satisfies MessageType);
        });
      return true;
    }
    case 'CONFIG_SAVED': {
      getConfig()
        .then((config) => syncAlarm(config))
        .then(() => sendResponse({ ok: true }));
      return true;
    }
    default:
      return false;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SCAN_STEP_ALARM) {
    processScanStep().catch((err) => {
      console.error(`${LOG_PREFIX} Scan step error:`, err);
      void getScanQueue().then((queue) => {
        if (queue && !scanAlreadyFinalized) {
          void finalizeScan(queue.totalNew, {
            error: err instanceof Error ? err.message : 'Scan step failed',
            telegramSent: queue.totalTelegramSent,
          });
        }
      });
    });
    return;
  }

  if (alarm.name === SCAN_KEEPALIVE_ALARM) {
    void tickKeepAlive();
    return;
  }

  if (alarm.name === ALARM_NAME) {
    void (async () => {
      if (!(await ensureNotScanning())) return;
      const config = await getConfig();
      startBackgroundScan(() => startScanQueue(config.groups));
    })();
  }
});

chrome.runtime.onStartup.addListener(() => {
  void resumeScanIfNeeded();
});

chrome.runtime.onInstalled.addListener(async () => {
  const config = await getConfig();
  await syncAlarm(config);
  await resumeScanIfNeeded();
});

void resumeScanIfNeeded();

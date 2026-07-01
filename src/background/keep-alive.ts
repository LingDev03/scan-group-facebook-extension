import { SCAN_KEEPALIVE_ALARM } from '../shared/scan-queue.ts';
import { getScanQueue } from '../shared/scan-queue.ts';

const KEEPALIVE_INTERVAL_MS = 20_000;
const LOG_PREFIX = '[FB Scanner]';

export async function ensureKeepAlive(): Promise<void> {
  try {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (!hasDoc) {
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL('offscreen.html'),
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: 'Keep the service worker alive during multi-group Facebook scans',
      });
      console.log(`${LOG_PREFIX} Keep-alive`, 'offscreen document created');
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} Keep-alive`, 'offscreen create failed', err);
  }

  await chrome.alarms.clear(SCAN_KEEPALIVE_ALARM);
  chrome.alarms.create(SCAN_KEEPALIVE_ALARM, { when: Date.now() + KEEPALIVE_INTERVAL_MS });
}

export async function stopKeepAlive(): Promise<void> {
  await chrome.alarms.clear(SCAN_KEEPALIVE_ALARM);

  try {
    if (await chrome.offscreen.hasDocument()) {
      await chrome.offscreen.closeDocument();
      console.log(`${LOG_PREFIX} Keep-alive`, 'offscreen document closed');
    }
  } catch {
    // document may already be closed
  }
}

export async function tickKeepAlive(): Promise<void> {
  const queue = await getScanQueue();
  if (!queue?.active || queue.stopped) {
    await stopKeepAlive();
    return;
  }

  await ensureKeepAlive();
}

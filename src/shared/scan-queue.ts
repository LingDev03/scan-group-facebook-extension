import type { GroupConfig } from './types.ts';

export const SCAN_QUEUE_KEY = 'scanQueue';
export const SCAN_STEP_ALARM = 'fb-scan-step';
export const SCAN_KEEPALIVE_ALARM = 'fb-scan-keepalive';

export interface ScanQueue {
  active: boolean;
  stopped: boolean;
  groups: GroupConfig[];
  currentIndex: number;
  totalNew: number;
  totalTelegramSent: number;
  mode: 'groups' | 'current_tab';
  activeTabId?: number;
}

export function createScanQueue(
  groups: GroupConfig[],
  options: { mode?: ScanQueue['mode']; activeTabId?: number } = {},
): ScanQueue {
  return {
    active: true,
    stopped: false,
    groups,
    currentIndex: 0,
    totalNew: 0,
    totalTelegramSent: 0,
    mode: options.mode ?? 'groups',
    activeTabId: options.activeTabId,
  };
}

export async function getScanQueue(): Promise<ScanQueue | null> {
  const result = await chrome.storage.local.get(SCAN_QUEUE_KEY);
  const queue = result[SCAN_QUEUE_KEY] as ScanQueue | undefined;
  if (!queue?.active) return null;
  return queue;
}

export async function saveScanQueue(queue: ScanQueue): Promise<void> {
  await chrome.storage.local.set({ [SCAN_QUEUE_KEY]: queue });
}

export async function clearScanQueue(): Promise<void> {
  await chrome.storage.local.remove(SCAN_QUEUE_KEY);
}

export async function markScanQueueStopped(): Promise<ScanQueue | null> {
  const queue = await getScanQueue();
  if (!queue) return null;
  queue.stopped = true;
  await saveScanQueue(queue);
  return queue;
}

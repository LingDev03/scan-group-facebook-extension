import {
  DEFAULT_SCAN_STATE,
  type ScannerConfig,
  type ScanState,
} from './types';
import { normalizeConfig } from './config-normalize';

export { normalizeGroupUrl, parseGroupLines } from './group-url';
export type { ParseGroupLinesResult } from './group-url';

const CONFIG_KEY = 'scannerConfig';
const STATE_KEY = 'scanState';

export { normalizeConfig, normalizeKeywordRules } from './config-normalize';

export async function getConfig(): Promise<ScannerConfig> {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  return normalizeConfig(result[CONFIG_KEY] as Partial<ScannerConfig> | undefined);
}

export async function saveConfig(config: ScannerConfig): Promise<void> {
  const normalized = normalizeConfig(config);
  await chrome.storage.local.set({ [CONFIG_KEY]: normalized });
}

export async function getScanState(): Promise<ScanState> {
  const result = await chrome.storage.local.get(STATE_KEY);
  return { ...DEFAULT_SCAN_STATE, ...(result[STATE_KEY] as ScanState | undefined) };
}

export async function saveScanState(state: Partial<ScanState>): Promise<void> {
  const current = await getScanState();
  await chrome.storage.local.set({ [STATE_KEY]: { ...current, ...state } });
}

export function getSeenIdsForGroup(state: ScanState, groupId: string): Set<string> {
  return new Set(state.seenPostIds[groupId] ?? []);
}

export function addSeenIds(
  state: ScanState,
  groupId: string,
  postIds: string[],
): Record<string, string[]> {
  const existing = state.seenPostIds[groupId] ?? [];
  const merged = [...new Set([...existing, ...postIds])];
  return { ...state.seenPostIds, [groupId]: merged };
}

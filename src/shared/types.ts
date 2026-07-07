export interface GroupConfig {
  id: string;
  name: string;
  url: string;
}

export interface KeywordRule {
  id: string;
  name?: string;
  keywords: string[];
}

export interface ScannerConfig {
  groups: GroupConfig[];
  /** @deprecated migrated to keywordRules on load */
  keywords?: string[];
  keywordRules: KeywordRule[];
  scanAfterDate?: string;
  schedule: { enabled: boolean; intervalMinutes: number };
  telegram: { enabled: boolean; botToken: string; chatId: string };
  export: { enabled: boolean; format: 'json' | 'csv' };
  scanBehavior: { maxScrolls: number; scrollDelayMs: number; scanConcurrency: number };
}

export interface PostAttachment {
  type: 'image' | 'video' | 'link' | 'file' | 'unknown';
  url?: string;
}

export interface ScrapedPost {
  id: string;
  text: string;
  /** Telegram HTML body extracted from post DOM when available */
  textHtml?: string;
  author: string;
  permalink: string;
  createdAt: string;
  attachments: PostAttachment[];
  matchedKeywords: string[];
  matchedRuleName?: string;
  groupId: string;
  groupName: string;
}

export interface ScanState {
  lastScanAt?: string;
  seenPostIds: Record<string, string[]>;
  lastMatchCount: number;
  isScanning: boolean;
  currentGroup?: string;
  progress?: { current: number; total: number; message: string };
}

export interface ScanResult {
  ok: boolean;
  matchCount: number;
  error?: string;
  stopped?: boolean;
  /** Scan queued; final result arrives via SCAN_DONE */
  started?: boolean;
}

export type MessageType =
  | { type: 'PING' }
  | { type: 'SCAN_NOW'; groupUrl?: string }
  | { type: 'SCAN_CURRENT_TAB' }
  | { type: 'STOP_SCAN' }
  | { type: 'CANCEL_SCAN' }
  | { type: 'SCAN_GROUP'; config: ScannerConfig; group: GroupConfig }
  | { type: 'SCAN_PROGRESS'; progress: ScanState['progress'] }
  | { type: 'SCAN_DONE'; matchCount: number; error?: string }
  | { type: 'GET_STATE' }
  | { type: 'STATE'; state: ScanState; config: ScannerConfig }
  | { type: 'TEST_TELEGRAM'; botToken: string; chatId: string }
  | { type: 'TEST_TELEGRAM_RESULT'; success: boolean; error?: string }
  | { type: 'CONFIG_SAVED' };

export const ALARM_NAME = 'fb-group-scan';

export const DEFAULT_CONFIG: ScannerConfig = {
  groups: [],
  keywordRules: [],
  scanAfterDate: undefined,
  schedule: { enabled: false, intervalMinutes: 60 },
  telegram: { enabled: false, botToken: '', chatId: '' },
  export: { enabled: true, format: 'json' },
  scanBehavior: { maxScrolls: 20, scrollDelayMs: 2000, scanConcurrency: 2 },
};

export const DEFAULT_SCAN_STATE: ScanState = {
  seenPostIds: {},
  lastMatchCount: 0,
  isScanning: false,
};

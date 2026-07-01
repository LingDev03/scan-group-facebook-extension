import { normalizeConfig } from './config-normalize.ts';
import type { ScannerConfig } from './types.ts';

export const SETTINGS_EXPORT_VERSION = 1;

export interface SettingsExportFile {
  version: typeof SETTINGS_EXPORT_VERSION;
  exportedAt: string;
  app: 'fb-group-scanner';
  config: ScannerConfig;
}

export function buildSettingsExport(config: ScannerConfig): SettingsExportFile {
  return {
    version: SETTINGS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'fb-group-scanner',
    config: normalizeConfig(config),
  };
}

export function parseSettingsImport(raw: string): ScannerConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON file');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid settings file');
  }

  const file = parsed as Partial<SettingsExportFile> & Partial<ScannerConfig>;

  if (file.app === 'fb-group-scanner' && file.config) {
    return normalizeConfig(file.config);
  }

  if (Array.isArray(file.groups) || Array.isArray(file.keywordRules)) {
    return normalizeConfig(file as Partial<ScannerConfig>);
  }

  throw new Error('Unrecognized settings format');
}

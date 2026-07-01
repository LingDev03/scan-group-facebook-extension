import type { ScannerConfig } from './types';
import { buildSettingsExport } from './settings-export';

export { buildSettingsExport, parseSettingsImport, SETTINGS_EXPORT_VERSION } from './settings-export';
export type { SettingsExportFile } from './settings-export';

export function downloadSettingsFile(config: ScannerConfig): void {
  const payload = buildSettingsExport(config);
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `fb-scanner-settings-${timestamp}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

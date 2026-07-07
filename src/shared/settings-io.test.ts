import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSettingsExport, parseSettingsImport } from './settings-export.ts';
import type { ScannerConfig } from './types.ts';

const sampleConfig: ScannerConfig = {
  groups: [{ id: '123', name: 'Test', url: 'https://www.facebook.com/groups/123' }],
  keywordRules: [{ id: 'r1', name: 'Java', keywords: ['JAVA', 'HCM'] }],
  scanAfterDate: '2025-06-01',
  schedule: { enabled: true, intervalMinutes: 60 },
  telegram: { enabled: true, botToken: 'token', chatId: 'chat' },
  export: { enabled: true, format: 'json' },
  scanBehavior: { maxScrolls: 20, scrollDelayMs: 2000, scanConcurrency: 2 },
};

describe('settings-export', () => {
  test('buildSettingsExport wraps config', () => {
    const file = buildSettingsExport(sampleConfig);
    assert.equal(file.app, 'fb-group-scanner');
    assert.equal(file.version, 1);
    assert.equal(file.config.groups.length, 1);
  });

  test('parseSettingsImport reads wrapped export', () => {
    const file = buildSettingsExport(sampleConfig);
    const config = parseSettingsImport(JSON.stringify(file));
    assert.equal(config.groups[0].id, '123');
    assert.equal(config.keywordRules[0].keywords[0], 'JAVA');
  });

  test('parseSettingsImport reads raw config', () => {
    const config = parseSettingsImport(JSON.stringify(sampleConfig));
    assert.equal(config.telegram.botToken, 'token');
  });

  test('parseSettingsImport rejects invalid json', () => {
    assert.throws(() => parseSettingsImport('{bad'), /Invalid JSON/);
  });
});

import { getConfig, saveConfig, parseGroupLines } from '../shared/storage';
import { formatRuleLabel } from '../shared/keyword-matcher';
import { downloadSettingsFile, parseSettingsImport } from '../shared/settings-io';
import type { GroupConfig, KeywordRule, MessageType, ScannerConfig } from '../shared/types';

const groupsList = document.getElementById('groups-list')!;
const keywordRulesList = document.getElementById('keyword-rules-list')!;
const groupUrlInput = document.getElementById('group-url-input') as HTMLTextAreaElement;
const groupAddStatus = document.getElementById('group-add-status')!;
const ruleNameInput = document.getElementById('rule-name-input') as HTMLInputElement;
const ruleKeywordsInput = document.getElementById('rule-keywords-input') as HTMLInputElement;
const scanAfterDate = document.getElementById('scan-after-date') as HTMLInputElement;
const maxScrolls = document.getElementById('max-scrolls') as HTMLInputElement;
const scrollDelay = document.getElementById('scroll-delay') as HTMLInputElement;
const scanConcurrency = document.getElementById('scan-concurrency') as HTMLInputElement;
const scheduleEnabled = document.getElementById('schedule-enabled') as HTMLInputElement;
const scheduleInterval = document.getElementById('schedule-interval') as HTMLSelectElement;
const telegramEnabled = document.getElementById('telegram-enabled') as HTMLInputElement;
const botToken = document.getElementById('bot-token') as HTMLInputElement;
const chatId = document.getElementById('chat-id') as HTMLInputElement;
const exportEnabled = document.getElementById('export-enabled') as HTMLInputElement;
const exportFormat = document.getElementById('export-format') as HTMLSelectElement;
const saveStatus = document.getElementById('save-status')!;
const importStatus = document.getElementById('import-status')!;
const importSettingsFile = document.getElementById('import-settings-file') as HTMLInputElement;
const telegramTestResult = document.getElementById('telegram-test-result')!;
const form = document.getElementById('options-form') as HTMLFormElement;

let groups: GroupConfig[] = [];
let keywordRules: KeywordRule[] = [];

function createRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function renderGroups(): void {
  groupsList.innerHTML = '';
  for (const group of groups) {
    const li = document.createElement('li');
    li.innerHTML = `<span title="${group.url}">${group.name || group.id}</span>`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      groups = groups.filter((g) => g.id !== group.id);
      renderGroups();
    });
    li.appendChild(removeBtn);
    groupsList.appendChild(li);
  }
}

function renderKeywordRules(): void {
  keywordRulesList.innerHTML = '';

  if (!keywordRules.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No rules yet. Add one above.';
    keywordRulesList.appendChild(empty);
    return;
  }

  for (const rule of keywordRules) {
    const card = document.createElement('div');
    card.className = 'rule-card';

    const header = document.createElement('div');
    header.className = 'rule-header';

    const title = document.createElement('span');
    title.className = 'rule-title';
    title.textContent = rule.name?.trim() || `Rule: ${formatRuleLabel(rule)}`;

    const removeRuleBtn = document.createElement('button');
    removeRuleBtn.type = 'button';
    removeRuleBtn.className = 'btn btn-small btn-muted';
    removeRuleBtn.textContent = 'Remove rule';
    removeRuleBtn.addEventListener('click', () => {
      keywordRules = keywordRules.filter((r) => r.id !== rule.id);
      renderKeywordRules();
    });

    header.appendChild(title);
    header.appendChild(removeRuleBtn);
    card.appendChild(header);

    const logicHint = document.createElement('p');
    logicHint.className = 'rule-logic';
    logicHint.textContent = 'All keywords below must appear in the post (AND):';
    card.appendChild(logicHint);

    const chips = document.createElement('ul');
    chips.className = 'chip-list';
    for (const kw of rule.keywords) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${kw}</span>`;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        rule.keywords = rule.keywords.filter((k) => k !== kw);
        if (!rule.keywords.length) {
          keywordRules = keywordRules.filter((r) => r.id !== rule.id);
        }
        renderKeywordRules();
      });
      li.appendChild(removeBtn);
      chips.appendChild(li);
    }
    card.appendChild(chips);

    const addRow = document.createElement('div');
    addRow.className = 'rule-add-keyword';
    const addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.placeholder = 'Add keyword to this rule';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-small';
    addBtn.textContent = 'Add';
    addBtn.addEventListener('click', () => {
      const kw = addInput.value.trim();
      if (kw && !rule.keywords.includes(kw)) {
        rule.keywords.push(kw);
        renderKeywordRules();
      }
      addInput.value = '';
    });
    addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addBtn.click();
      }
    });
    addRow.appendChild(addInput);
    addRow.appendChild(addBtn);
    card.appendChild(addRow);

    keywordRulesList.appendChild(card);
  }
}

function showGroupAddStatus(parts: string[], type: 'success' | 'warn' | 'error'): void {
  if (!parts.length) {
    groupAddStatus.hidden = true;
    return;
  }
  groupAddStatus.textContent = parts.join(' ');
  groupAddStatus.className = `group-add-status ${type}`;
  groupAddStatus.hidden = false;
}

document.getElementById('btn-add-group')!.addEventListener('click', () => {
  const raw = groupUrlInput.value;
  if (!raw.trim()) return;

  const existingIds = new Set(groups.map((g) => g.id));
  const { added, duplicates, invalid } = parseGroupLines(raw, existingIds);

  for (const item of added) {
    groups.push({
      id: item.id,
      name: item.id,
      url: item.url,
    });
  }

  groupUrlInput.value = '';
  renderGroups();

  const messages: string[] = [];
  if (added.length) {
    messages.push(`Added ${added.length} group${added.length === 1 ? '' : 's'}.`);
  }
  if (duplicates.length) {
    messages.push(`${duplicates.length} duplicate${duplicates.length === 1 ? '' : 's'} skipped.`);
  }
  if (invalid.length) {
    messages.push(`${invalid.length} invalid line${invalid.length === 1 ? '' : 's'} skipped.`);
  }

  if (!added.length && (duplicates.length || invalid.length)) {
    showGroupAddStatus(messages, 'warn');
  } else if (invalid.length) {
    showGroupAddStatus(messages, 'warn');
  } else if (added.length) {
    showGroupAddStatus(messages, 'success');
  }
});

groupUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    document.getElementById('btn-add-group')!.click();
  }
});

document.getElementById('btn-add-rule')!.addEventListener('click', () => {
  const raw = ruleKeywordsInput.value.trim();
  if (!raw) return;

  const keywords = raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  if (!keywords.length) return;

  keywordRules.push({
    id: createRuleId(),
    name: ruleNameInput.value.trim() || undefined,
    keywords,
  });

  ruleNameInput.value = '';
  ruleKeywordsInput.value = '';
  renderKeywordRules();
});

ruleKeywordsInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('btn-add-rule')!.click();
  }
});

document.getElementById('btn-clear-date')!.addEventListener('click', () => {
  scanAfterDate.value = '';
});

document.getElementById('btn-test-telegram')!.addEventListener('click', async () => {
  telegramTestResult.textContent = 'Testing...';
  telegramTestResult.className = 'test-result';

  const response = await chrome.runtime.sendMessage({
    type: 'TEST_TELEGRAM',
    botToken: botToken.value.trim(),
    chatId: chatId.value.trim(),
  } satisfies MessageType);

  if (response?.success) {
    telegramTestResult.textContent = '✓ Connected';
    telegramTestResult.className = 'test-result success';
  } else {
    telegramTestResult.textContent = response?.error ?? 'Failed';
    telegramTestResult.className = 'test-result error';
  }
});

function collectConfig(): ScannerConfig {
  return {
    groups,
    keywordRules,
    scanAfterDate: scanAfterDate.value || undefined,
    schedule: {
      enabled: scheduleEnabled.checked,
      intervalMinutes: Number(scheduleInterval.value),
    },
    telegram: {
      enabled: telegramEnabled.checked,
      botToken: botToken.value.trim(),
      chatId: chatId.value.trim(),
    },
    export: {
      enabled: exportEnabled.checked,
      format: exportFormat.value as 'json' | 'csv',
    },
    scanBehavior: {
      maxScrolls: Number(maxScrolls.value) || 20,
      scrollDelayMs: Number(scrollDelay.value) || 2000,
      scanConcurrency: Number(scanConcurrency.value) || 2,
    },
  };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const config = collectConfig();
  await saveConfig(config);
  await chrome.runtime.sendMessage({ type: 'CONFIG_SAVED' } satisfies MessageType);
  saveStatus.textContent = 'Saved!';
  setTimeout(() => { saveStatus.textContent = ''; }, 3000);
});

function showImportStatus(message: string, type: 'success' | 'error'): void {
  importStatus.textContent = message;
  importStatus.className = `import-status ${type}`;
  importStatus.hidden = false;
}

function applyConfigToForm(config: ScannerConfig): void {
  groups = config.groups;
  keywordRules = config.keywordRules;
  scanAfterDate.value = config.scanAfterDate ?? '';
  maxScrolls.value = String(config.scanBehavior.maxScrolls);
  scrollDelay.value = String(config.scanBehavior.scrollDelayMs);
  scanConcurrency.value = String(config.scanBehavior.scanConcurrency);
  scheduleEnabled.checked = config.schedule.enabled;
  scheduleInterval.value = String(config.schedule.intervalMinutes);
  telegramEnabled.checked = config.telegram.enabled;
  botToken.value = config.telegram.botToken;
  chatId.value = config.telegram.chatId;
  exportEnabled.checked = config.export.enabled;
  exportFormat.value = config.export.format;
  renderGroups();
  renderKeywordRules();
}

document.getElementById('btn-export-settings')!.addEventListener('click', async () => {
  const config = collectConfig();
  downloadSettingsFile(config);
  saveStatus.textContent = 'Settings exported!';
  setTimeout(() => { saveStatus.textContent = ''; }, 3000);
});

importSettingsFile.addEventListener('change', async () => {
  const file = importSettingsFile.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const imported = parseSettingsImport(text);
    await saveConfig(imported);
    await chrome.runtime.sendMessage({ type: 'CONFIG_SAVED' } satisfies MessageType);
    applyConfigToForm(imported);
    showImportStatus('Settings imported successfully.', 'success');
    saveStatus.textContent = 'Imported & saved!';
    setTimeout(() => { saveStatus.textContent = ''; }, 3000);
  } catch (err) {
    showImportStatus(
      err instanceof Error ? err.message : 'Import failed',
      'error',
    );
  } finally {
    importSettingsFile.value = '';
  }
});

async function loadConfig(): Promise<void> {
  const config = await getConfig();
  applyConfigToForm(config);
}

loadConfig();

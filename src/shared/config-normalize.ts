import { DEFAULT_CONFIG, type KeywordRule, type ScannerConfig } from './types.ts';

function createRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function clampScanConcurrency(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CONFIG.scanBehavior.scanConcurrency;
  return Math.min(4, Math.max(1, Math.round(n)));
}

function normalizeScanBehavior(
  raw?: Partial<ScannerConfig['scanBehavior']>,
): ScannerConfig['scanBehavior'] {
  const base = DEFAULT_CONFIG.scanBehavior;
  const maxScrolls = Number(raw?.maxScrolls);
  const scrollDelayMs = Number(raw?.scrollDelayMs);

  return {
    maxScrolls: Number.isFinite(maxScrolls) && maxScrolls > 0
      ? Math.min(100, Math.max(1, Math.round(maxScrolls)))
      : base.maxScrolls,
    scrollDelayMs: Number.isFinite(scrollDelayMs) && scrollDelayMs >= 500
      ? Math.min(10_000, Math.round(scrollDelayMs))
      : base.scrollDelayMs,
    scanConcurrency: clampScanConcurrency(raw?.scanConcurrency ?? base.scanConcurrency),
  };
}

/** Migrate legacy flat keywords (OR) to keyword rules (one keyword per rule). */
export function normalizeKeywordRules(config: Partial<ScannerConfig>): KeywordRule[] {
  if (config.keywordRules?.length) {
    return config.keywordRules.map((rule) => ({
      id: rule.id || createRuleId(),
      name: rule.name,
      keywords: rule.keywords.filter((k) => k.trim()),
    }));
  }

  const legacy = config.keywords ?? [];
  if (!legacy.length) return [];

  return legacy.map((kw) => ({
    id: createRuleId(),
    keywords: [kw],
  }));
}

export function normalizeConfig(raw?: Partial<ScannerConfig>): ScannerConfig {
  const merged = { ...DEFAULT_CONFIG, ...raw };
  return {
    ...merged,
    keywordRules: normalizeKeywordRules(merged),
    keywords: undefined,
    scanBehavior: normalizeScanBehavior(merged.scanBehavior),
  };
}

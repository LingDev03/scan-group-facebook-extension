import { DEFAULT_CONFIG, type KeywordRule, type ScannerConfig } from './types.ts';

function createRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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
  };
}

import type { KeywordRule } from './types';

export function matchKeywordsInText(text: string, keywords: string[]): string[] {
  if (!keywords.length) return [];
  const lower = text.toLowerCase();
  return keywords.filter((kw) => kw.trim() && lower.includes(kw.trim().toLowerCase()));
}

/** All keywords in the rule must match (AND). */
export function ruleMatches(text: string, rule: KeywordRule): string[] | null {
  const kws = rule.keywords.map((k) => k.trim()).filter(Boolean);
  if (!kws.length) return null;

  const matched = matchKeywordsInText(text, kws);
  if (matched.length !== kws.length) return null;

  return matched;
}

export interface KeywordMatchResult {
  matchedKeywords: string[];
  matchedRuleId?: string;
  matchedRuleName?: string;
}

/**
 * OR between rules, AND within each rule.
 * Post matches if any rule has all its keywords present.
 */
export function matchKeywordRules(text: string, rules: KeywordRule[]): KeywordMatchResult | null {
  if (!rules.length) return null;

  for (const rule of rules) {
    const matched = ruleMatches(text, rule);
    if (matched) {
      return {
        matchedKeywords: matched,
        matchedRuleId: rule.id,
        matchedRuleName: rule.name,
      };
    }
  }

  return null;
}

export function hasKeywordRulesMatch(text: string, rules: KeywordRule[]): boolean {
  return matchKeywordRules(text, rules) !== null;
}

/** @deprecated Use matchKeywordRules — kept for tests */
export function matchKeywords(text: string, keywords: string[]): string[] {
  return matchKeywordsInText(text, keywords);
}

/** @deprecated Use hasKeywordRulesMatch */
export function hasKeywordMatch(text: string, keywords: string[]): boolean {
  return matchKeywords(text, keywords).length > 0;
}

export function formatRuleLabel(rule: KeywordRule): string {
  const name = rule.name?.trim();
  const kws = rule.keywords.join(' + ');
  return name ? `${name}: ${kws}` : kws;
}

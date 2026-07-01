import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchKeywords,
  matchKeywordRules,
  ruleMatches,
  hasKeywordMatch,
} from './keyword-matcher.ts';
import { isPostAfterDate, parseISODate, startOfDay } from './date-filter.ts';
import type { KeywordRule } from './types.ts';

describe('keyword-matcher', () => {
  test('matchKeywords finds case-insensitive matches', () => {
    const matches = matchKeywords('Looking for Java developer', ['java', 'python']);
    assert.deepEqual(matches, ['java']);
  });

  test('hasKeywordMatch returns false when no keywords', () => {
    assert.equal(hasKeywordMatch('hello world', []), false);
  });

  test('ruleMatches requires all keywords (AND)', () => {
    const rule: KeywordRule = {
      id: '1',
      name: 'Java job HCM',
      keywords: ['HCM', 'REMOTE', 'JAVA'],
    };
    assert.equal(
      ruleMatches('Tuyển JAVA dev REMOTE tại HCM', rule)?.length,
      3,
    );
    assert.equal(ruleMatches('Tuyển JAVA dev REMOTE', rule), null);
  });

  test('matchKeywordRules matches any rule (OR)', () => {
    const rules: KeywordRule[] = [
      { id: '1', keywords: ['HCM', 'JAVA'] },
      { id: '2', keywords: ['HN', 'PYTHON'] },
    ];
    const result = matchKeywordRules('Job PYTHON ở HN', rules);
    assert.ok(result);
    assert.deepEqual(result!.matchedKeywords, ['HN', 'PYTHON']);
  });

  test('matchKeywordRules returns rule name when set', () => {
    const rules: KeywordRule[] = [
      { id: '1', name: 'Remote Java', keywords: ['REMOTE', 'JAVA'] },
    ];
    const result = matchKeywordRules('REMOTE JAVA developer', rules);
    assert.equal(result?.matchedRuleName, 'Remote Java');
  });
});

describe('date-filter', () => {
  test('isPostAfterDate includes same day', () => {
    const post = new Date(2025, 5, 20, 14, 0, 0);
    assert.equal(isPostAfterDate(post, '2025-06-20'), true);
  });

  test('isPostAfterDate excludes day before', () => {
    const post = new Date(2025, 5, 19, 23, 59, 59);
    assert.equal(isPostAfterDate(post, '2025-06-20'), false);
  });

  test('isPostAfterDate includes later dates', () => {
    const post = new Date(2025, 5, 25);
    assert.equal(isPostAfterDate(post, '2025-06-20'), true);
  });

  test('isPostAfterDate passes when no cutoff set', () => {
    const post = new Date(2020, 0, 1);
    assert.equal(isPostAfterDate(post, undefined), true);
  });

  test('startOfDay sets midnight', () => {
    const d = startOfDay(new Date(2025, 5, 20, 15, 30));
    assert.equal(d.getHours(), 0);
    assert.equal(d.getMinutes(), 0);
  });

  test('parseISODate parses YYYY-MM-DD', () => {
    const d = parseISODate('2025-06-20');
    assert.equal(d.getFullYear(), 2025);
    assert.equal(d.getMonth(), 5);
    assert.equal(d.getDate(), 20);
  });
});

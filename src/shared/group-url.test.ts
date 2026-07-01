import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGroupUrl, parseGroupLines } from './group-url.ts';

describe('parseGroupLines', () => {
  test('adds one group per line', () => {
    const result = parseGroupLines('A\nB', new Set());
    assert.equal(result.added.length, 2);
    assert.equal(result.added[0].id, 'A');
    assert.equal(result.added[1].id, 'B');
  });

  test('skips duplicates in input and existing', () => {
    const result = parseGroupLines('A\nA\nB', new Set(['B']));
    assert.equal(result.added.length, 1);
    assert.equal(result.added[0].id, 'A');
    assert.equal(result.duplicates.length, 2);
  });

  test('skips invalid lines', () => {
    const result = parseGroupLines('valid-slug\n!!!', new Set());
    assert.equal(result.added.length, 1);
    assert.equal(result.invalid.length, 1);
  });

  test('normalizeGroupUrl accepts full URL', () => {
    const g = normalizeGroupUrl('https://www.facebook.com/groups/12345');
    assert.equal(g?.id, '12345');
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clampScanConcurrency, normalizeConfig } from './config-normalize.ts';

describe('clampScanConcurrency', () => {
  it('defaults invalid values to 2', () => {
    assert.equal(clampScanConcurrency(undefined), 2);
    assert.equal(clampScanConcurrency('x'), 2);
  });

  it('clamps between 1 and 4', () => {
    assert.equal(clampScanConcurrency(0), 1);
    assert.equal(clampScanConcurrency(1), 1);
    assert.equal(clampScanConcurrency(2), 2);
    assert.equal(clampScanConcurrency(4), 4);
    assert.equal(clampScanConcurrency(99), 4);
  });
});

describe('normalizeConfig scanBehavior', () => {
  it('adds scanConcurrency default when missing', () => {
    const config = normalizeConfig({
      scanBehavior: { maxScrolls: 10, scrollDelayMs: 1000 },
    });
    assert.equal(config.scanBehavior.scanConcurrency, 2);
  });

  it('clamps scanConcurrency from raw config', () => {
    const config = normalizeConfig({
      scanBehavior: { maxScrolls: 10, scrollDelayMs: 1000, scanConcurrency: 8 },
    });
    assert.equal(config.scanBehavior.scanConcurrency, 4);
  });
});

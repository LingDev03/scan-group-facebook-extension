import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createScanQueue, pickScanBatch } from './scan-queue.ts';
import type { GroupConfig } from './types.ts';

const sampleGroup: GroupConfig = {
  id: '1',
  name: 'Test Group',
  url: 'https://www.facebook.com/groups/1',
};

const groups: GroupConfig[] = [
  { id: '1', name: 'A', url: 'https://www.facebook.com/groups/1' },
  { id: '2', name: 'B', url: 'https://www.facebook.com/groups/2' },
  { id: '3', name: 'C', url: 'https://www.facebook.com/groups/3' },
  { id: '4', name: 'D', url: 'https://www.facebook.com/groups/4' },
  { id: '5', name: 'E', url: 'https://www.facebook.com/groups/5' },
];

describe('createScanQueue', () => {
  it('creates an active queue at index 0', () => {
    const queue = createScanQueue([sampleGroup]);
    assert.equal(queue.active, true);
    assert.equal(queue.stopped, false);
    assert.equal(queue.currentIndex, 0);
    assert.equal(queue.groups.length, 1);
    assert.equal(queue.mode, 'groups');
    assert.equal(queue.concurrency, 2);
  });

  it('supports current tab mode', () => {
    const queue = createScanQueue([sampleGroup], { mode: 'current_tab', activeTabId: 42 });
    assert.equal(queue.mode, 'current_tab');
    assert.equal(queue.activeTabId, 42);
  });

  it('stores custom concurrency', () => {
    const queue = createScanQueue(groups, { concurrency: 3 });
    assert.equal(queue.concurrency, 3);
  });
});

describe('pickScanBatch', () => {
  it('returns up to concurrency groups from start index', () => {
    assert.deepEqual(pickScanBatch(groups, 0, 2).map((g) => g.name), ['A', 'B']);
    assert.deepEqual(pickScanBatch(groups, 2, 2).map((g) => g.name), ['C', 'D']);
    assert.deepEqual(pickScanBatch(groups, 4, 2).map((g) => g.name), ['E']);
  });

  it('returns at least one slot when concurrency is invalid', () => {
    assert.equal(pickScanBatch(groups, 0, 0).length, 1);
  });
});

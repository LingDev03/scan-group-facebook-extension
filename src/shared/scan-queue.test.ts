import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createScanQueue } from './scan-queue.ts';
import type { GroupConfig } from './types.ts';

const sampleGroup: GroupConfig = {
  id: '1',
  name: 'Test Group',
  url: 'https://www.facebook.com/groups/1',
};

describe('createScanQueue', () => {
  it('creates an active queue at index 0', () => {
    const queue = createScanQueue([sampleGroup]);
    assert.equal(queue.active, true);
    assert.equal(queue.stopped, false);
    assert.equal(queue.currentIndex, 0);
    assert.equal(queue.groups.length, 1);
    assert.equal(queue.mode, 'groups');
  });

  it('supports current tab mode', () => {
    const queue = createScanQueue([sampleGroup], { mode: 'current_tab', activeTabId: 42 });
    assert.equal(queue.mode, 'current_tab');
    assert.equal(queue.activeTabId, 42);
  });
});

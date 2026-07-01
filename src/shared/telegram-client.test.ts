import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatTelegramMessage,
  getPrimaryImageUrl,
  normalizeNewlines,
} from './telegram-client.ts';
import type { ScrapedPost } from './types.ts';

function samplePost(overrides: Partial<ScrapedPost> = {}): ScrapedPost {
  return {
    id: '1',
    text: 'Line one\n\nLine two',
    author: 'Alice',
    permalink: 'https://www.facebook.com/groups/1/posts/1',
    createdAt: '2026-01-15T10:00:00.000Z',
    attachments: [],
    matchedKeywords: ['java'],
    matchedRuleName: 'Java jobs',
    groupId: 'g1',
    groupName: 'Dev Group',
    ...overrides,
  };
}

describe('normalizeNewlines', () => {
  it('collapses excessive blank lines', () => {
    assert.equal(normalizeNewlines('a\r\n\r\n\r\n\r\nb'), 'a\n\nb');
  });
});

describe('formatTelegramMessage', () => {
  it('does not wrap content in pre tags', () => {
    const message = formatTelegramMessage(samplePost());
    assert.ok(!message.includes('<pre>'));
    assert.ok(message.includes('Line one'));
    assert.ok(message.includes('Line two'));
  });

  it('includes separator and metadata block', () => {
    const message = formatTelegramMessage(samplePost());
    assert.ok(message.includes('────────────'));
    assert.ok(message.includes('<i>Rule:</i>'));
    assert.ok(message.includes('Java jobs'));
    assert.ok(message.includes('Open on Facebook'));
  });

  it('escapes HTML in post content', () => {
    const message = formatTelegramMessage(samplePost({ text: '<script>alert(1)</script>' }));
    assert.ok(message.includes('&lt;script&gt;'));
    assert.ok(!message.includes('<script>'));
  });

  it('uses textHtml without double escaping', () => {
    const message = formatTelegramMessage(samplePost({
      text: 'plain fallback',
      textHtml: 'Line one\n\n<b>Bold</b> and <a href="https://example.com">link</a>',
    }));
    assert.ok(message.includes('<b>Bold</b>'));
    assert.ok(message.includes('<a href="https://example.com">link</a>'));
    assert.ok(!message.includes('&lt;b&gt;'));
  });
});

describe('getPrimaryImageUrl', () => {
  it('returns first image attachment url', () => {
    const url = getPrimaryImageUrl(
      samplePost({
        attachments: [
          { type: 'image', url: 'https://example.com/a.jpg' },
          { type: 'image', url: 'https://example.com/b.jpg' },
        ],
      }),
    );
    assert.equal(url, 'https://example.com/a.jpg');
  });

  it('returns undefined when no image', () => {
    assert.equal(getPrimaryImageUrl(samplePost()), undefined);
  });
});

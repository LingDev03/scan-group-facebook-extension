import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  escapeTelegramHtml,
  normalizeTelegramHtml,
  pickRicherTelegramHtml,
  plainTextLengthFromHtml,
} from './dom-to-telegram-html.ts';

describe('escapeTelegramHtml', () => {
  it('escapes special characters', () => {
    assert.equal(escapeTelegramHtml('a & b <c>'), 'a &amp; b &lt;c&gt;');
  });
});

describe('normalizeTelegramHtml', () => {
  it('collapses excessive newlines', () => {
    assert.equal(normalizeTelegramHtml('a\n\n\n\nb'), 'a\n\nb');
  });
});

describe('pickRicherTelegramHtml', () => {
  it('prefers html with more visible text', () => {
    const short = 'Hi';
    const long = 'Hi <b>there</b> with <a href="https://x.com">link</a>';
    assert.equal(pickRicherTelegramHtml(short, long), long);
    assert.equal(plainTextLengthFromHtml(long), 'Hi there with link'.length);
  });
});

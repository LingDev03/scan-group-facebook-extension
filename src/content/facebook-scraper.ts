import { isPostAfterDate, parsePostDate } from '../shared/date-filter';
import { domElementToTelegramHtml, pickRicherTelegramHtml } from '../shared/dom-to-telegram-html';
import { matchKeywordRules } from '../shared/keyword-matcher';
import type { GroupConfig, MessageType, PostAttachment, ScannerConfig, ScrapedPost } from '../shared/types';

interface RawPost {
  id: string;
  text: string;
  textHtml?: string;
  author: string;
  permalink: string;
  createdAt: Date;
  attachments: PostAttachment[];
}

const capturedPosts = new Map<string, RawPost>();
let interceptorInstalled = false;
let scanCancelled = false;

const LOG_PREFIX = '[FB Scanner]';

function log(stage: string, detail?: string | Record<string, unknown>): void {
  if (detail === undefined) {
    console.log(`${LOG_PREFIX} ${stage}`);
    return;
  }
  if (typeof detail === 'string') {
    console.log(`${LOG_PREFIX} ${stage} — ${detail}`);
    return;
  }
  console.log(`${LOG_PREFIX} ${stage}`, detail);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function interruptibleSleep(ms: number): Promise<void> {
  const step = 50;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    if (scanCancelled) return;
    await sleep(Math.min(step, ms - elapsed));
  }
}

function installGraphQLInterceptor(): void {
  if (interceptorInstalled) {
    log('GraphQL interceptor', 'already active');
    return;
  }
  interceptorInstalled = true;
  log('GraphQL interceptor', 'installed');

  const originalFetch = window.fetch.bind(window);
  const beforeCount = () => capturedPosts.size;
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : '';
      if (url.includes('/api/graphql')) {
        const clone = response.clone();
        clone
          .json()
          .then((data) => {
            const prev = beforeCount();
            extractPostsFromGraphQL(data);
            const added = capturedPosts.size - prev;
            if (added > 0) {
              log('GraphQL capture', `+${added} post(s), total ${capturedPosts.size}`);
            }
          })
          .catch(() => undefined);
      }
    } catch {
      // ignore interceptor errors
    }
    return response;
  };
}

function walkObject(obj: unknown, visitor: (node: Record<string, unknown>) => void): void {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) walkObject(item, visitor);
    return;
  }
  const record = obj as Record<string, unknown>;
  visitor(record);
  for (const value of Object.values(record)) {
    walkObject(value, visitor);
  }
}

function extractPostsFromGraphQL(data: unknown): void {
  walkObject(data, (node) => {
    const story = node.comet_sections ?? node.story ?? node;
    const message = (story as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
    const text =
      (message?.text as string | undefined) ??
      (node.message as Record<string, unknown> | undefined)?.text as string | undefined;

    if (!text || typeof text !== 'string') return;

    const id =
      (node.post_id as string | undefined) ??
      (node.legacy_story_id as string | undefined) ??
      (node.id as string | undefined);

    if (!id || capturedPosts.has(id)) return;

    const creationTime =
      node.creation_time ??
      node.created_time ??
      (node as Record<string, unknown>).timestamp;

    const createdAt = parsePostDate(creationTime);
    if (!createdAt) return;

    const authorNode =
      (node.actors as Array<Record<string, unknown>> | undefined)?.[0] ??
      (node.actor as Record<string, unknown> | undefined) ??
      (node.author as Record<string, unknown> | undefined);

    const author =
      (authorNode?.name as string | undefined) ??
      (authorNode?.text as string | undefined) ??
      'Unknown';

    const permalink =
      (node.url as string | undefined) ??
      (node.wwwURL as string | undefined) ??
      `https://www.facebook.com/groups/${location.pathname.split('/')[2]}/posts/${id}`;

    capturedPosts.set(id, {
      id,
      text,
      author,
      permalink,
      createdAt,
      attachments: extractAttachments(node),
    });
  });
}

function extractAttachments(node: Record<string, unknown>): PostAttachment[] {
  const attachments: PostAttachment[] = [];
  const media = node.attachments as Array<Record<string, unknown>> | undefined;
  if (media) {
    for (const item of media) {
      const mediaObj = item.media as Record<string, unknown> | undefined;
      const url =
        (mediaObj?.image as Record<string, unknown> | undefined)?.uri as string | undefined ??
        (mediaObj?.playable_url as string | undefined);
      if (url) attachments.push({ type: 'image', url });
    }
  }
  return attachments;
}

const SEE_MORE_LABELS = [
  'see more',
  'see more...',
  'xem thêm',
  'xem thêm...',
  'voir plus',
  'ver más',
];

function isSeeMoreElement(el: Element): boolean {
  const label = el.textContent?.trim().toLowerCase() ?? '';
  if (!label || label.length > 40) return false;
  return SEE_MORE_LABELS.some((pattern) => label === pattern || label.startsWith(`${pattern}`));
}

async function expandSeeMoreButtons(context = 'scroll'): Promise<number> {
  const articles = document.querySelectorAll('[role="article"]');
  let clicked = 0;

  for (const article of Array.from(articles)) {
    if (scanCancelled) return clicked;

    const candidates = article.querySelectorAll(
      '[role="button"], div[tabindex="0"], span[role="button"]',
    );

    for (const el of Array.from(candidates)) {
      if (!isSeeMoreElement(el)) continue;
      (el as HTMLElement).click();
      clicked++;
      await sleep(80);
    }
  }

  if (clicked > 0) {
    log('See more', `clicked ${clicked} button(s) during ${context}`);
    await interruptibleSleep(400);
  }

  return clicked;
}

function extractAttachmentsFromArticle(article: Element): PostAttachment[] {
  const attachments: PostAttachment[] = [];
  const seen = new Set<string>();

  const imgs = article.querySelectorAll('img[src*="scontent"], img[src*="fbcdn.net"]');
  for (const img of Array.from(imgs)) {
    const src = (img as HTMLImageElement).src;
    if (!src || seen.has(src)) continue;
    if (src.includes('emoji') || src.includes('/static.')) continue;
    seen.add(src);
    attachments.push({ type: 'image', url: src });
  }

  return attachments;
}

function parsePostsFromDOM(): RawPost[] {
  const posts: RawPost[] = [];
  const articles = document.querySelectorAll('[role="article"]');

  for (const article of Array.from(articles)) {
    const textEl =
      article.querySelector('[data-ad-preview="message"]') ??
      article.querySelector('[data-ad-comet-preview="message"]') ??
      article.querySelector('div[dir="auto"]');

    const text = textEl?.textContent?.trim() ?? '';
    if (!text) continue;

    const textHtml = textEl ? domElementToTelegramHtml(textEl) : undefined;

    const linkEl = article.querySelector('a[href*="/posts/"], a[href*="/permalink/"]') as HTMLAnchorElement | null;
    const permalink = linkEl?.href ?? location.href;
    const idMatch = permalink.match(/posts\/(\d+)|permalink\/(\d+)|story_fbid=(\d+)/);
    const id = idMatch ? (idMatch[1] ?? idMatch[2] ?? idMatch[3]) : `dom-${hashCode(text.slice(0, 100))}`;

    if (capturedPosts.has(id)) continue;

    const authorEl =
      article.querySelector('h2 a, h3 a, strong a, a[role="link"]') as HTMLAnchorElement | null;
    const author = authorEl?.textContent?.trim() ?? 'Unknown';

    const timeEl = article.querySelector('a abbr, abbr, time');
    const timeAttr = timeEl?.getAttribute('title') ?? timeEl?.getAttribute('datetime') ?? '';
    const createdAt = parsePostDate(timeAttr) ?? new Date();

    posts.push({
      id,
      text,
      textHtml: textHtml || undefined,
      author,
      permalink,
      createdAt,
      attachments: extractAttachmentsFromArticle(article),
    });
  }

  return posts;
}

function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function mergeDomPost(existing: RawPost, domPost: RawPost): RawPost {
  const longerText = domPost.text.length > existing.text.length ? domPost.text : existing.text;
  const textHtml = pickRicherTelegramHtml(existing.textHtml, domPost.textHtml);
  const attachments = existing.attachments.length ? existing.attachments : domPost.attachments;
  return { ...existing, text: longerText, textHtml, attachments };
}

function collectAllPosts(): RawPost[] {
  const beforeGraphql = capturedPosts.size;
  const domPosts = parsePostsFromDOM();
  let domAdded = 0;
  let domMerged = 0;

  for (const post of domPosts) {
    const existing = capturedPosts.get(post.id);
    if (!existing) {
      capturedPosts.set(post.id, post);
      domAdded++;
    } else {
      capturedPosts.set(post.id, mergeDomPost(existing, post));
      domMerged++;
    }
  }

  if (domAdded > 0 || domMerged > 0) {
    log('DOM collect', {
      domParsed: domPosts.length,
      domAdded,
      domMerged,
      graphqlBefore: beforeGraphql,
      total: capturedPosts.size,
    });
  }

  return [...capturedPosts.values()];
}

function filterPosts(
  posts: RawPost[],
  config: ScannerConfig,
  group: GroupConfig,
): ScrapedPost[] {
  const results: ScrapedPost[] = [];
  let skippedByDate = 0;
  let skippedByKeyword = 0;

  for (const post of posts) {
    if (!isPostAfterDate(post.createdAt, config.scanAfterDate)) {
      skippedByDate++;
      continue;
    }

    const searchText = `${post.text}`;
    const keywordMatch = matchKeywordRules(searchText, config.keywordRules);
    if (!config.keywordRules.length || !keywordMatch) {
      skippedByKeyword++;
      continue;
    }

    results.push({
      id: post.id,
      text: post.text,
      textHtml: post.textHtml,
      author: post.author,
      permalink: post.permalink,
      createdAt: post.createdAt.toISOString(),
      attachments: post.attachments,
      matchedKeywords: keywordMatch.matchedKeywords,
      matchedRuleName: keywordMatch.matchedRuleName,
      groupId: group.id,
      groupName: group.name,
    });
  }

  log('Filter posts', {
    input: posts.length,
    matched: results.length,
    skippedByDate,
    skippedByKeyword,
    rules: config.keywordRules.length,
    scanAfterDate: config.scanAfterDate ?? 'none',
  });

  return results;
}

async function scrollFeed(config: ScannerConfig): Promise<void> {
  const { maxScrolls, scrollDelayMs } = config.scanBehavior;
  let consecutiveOld = 0;

  log('Scroll feed', `starting (${maxScrolls} max scrolls, ${scrollDelayMs}ms delay)`);

  for (let i = 0; i < maxScrolls; i++) {
    if (scanCancelled) {
      log('Scroll feed', `stopped at scroll ${i + 1}/${maxScrolls} (cancelled)`);
      return;
    }

    window.scrollTo(0, document.body.scrollHeight);
    await interruptibleSleep(scrollDelayMs);
    await expandSeeMoreButtons(`scroll ${i + 1}/${maxScrolls}`);

    const posts = collectAllPosts();
    log('Scroll progress', `${i + 1}/${maxScrolls} — ${posts.length} post(s) collected`);

    if (config.scanAfterDate) {
      const recentPosts = posts.slice(-5);
      const allOld = recentPosts.length > 0 && recentPosts.every(
        (p) => !isPostAfterDate(p.createdAt, config.scanAfterDate),
      );
      if (allOld) {
        consecutiveOld++;
        log('Scroll feed', `batch ${consecutiveOld}/3 older than scan-after date`);
        if (consecutiveOld >= 3) {
          log('Scroll feed', `early stop at scroll ${i + 1}/${maxScrolls} (old posts)`);
          return;
        }
      } else {
        consecutiveOld = 0;
      }
    }
  }

  log('Scroll feed', `finished all ${maxScrolls} scroll(s)`);
}

async function scanGroup(config: ScannerConfig, group: GroupConfig): Promise<ScrapedPost[]> {
  scanCancelled = false;
  capturedPosts.clear();
  log('Scan start', group.name);

  installGraphQLInterceptor();

  log('Page wait', '2s for feed to load');
  await interruptibleSleep(2000);
  if (scanCancelled) {
    log('Scan cancelled', 'during page wait');
    return [];
  }

  log('Initial expand', 'checking See more buttons');
  await expandSeeMoreButtons('initial');
  const initialPosts = collectAllPosts();
  log('Initial collect', `${initialPosts.length} post(s)`);

  await scrollFeed(config);
  if (scanCancelled) {
    log('Scan cancelled', 'during scroll');
    return [];
  }

  log('Final collect', 'merging GraphQL + DOM');
  const allPosts = collectAllPosts();
  log('Final collect', `${allPosts.length} post(s) before filter`);

  const matches = filterPosts(allPosts, config, group);
  log('Scan complete', `${matches.length} match(es) for ${group.name}`);
  return matches;
}

chrome.runtime.onMessage.addListener((message: MessageType, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'CANCEL_SCAN') {
    scanCancelled = true;
    log('Scan cancelled', 'CANCEL_SCAN received');
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'SCAN_GROUP') {
    scanGroup(message.config, message.group)
      .then((matches) => {
        if (scanCancelled) {
          sendResponse({ success: false, cancelled: true, matches: [] });
        } else {
          sendResponse({ success: true, matches });
        }
      })
      .catch((err: Error) => sendResponse({ success: false, error: err.message, matches: [] }));
    return true;
  }
  return false;
});

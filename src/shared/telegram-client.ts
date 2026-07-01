import type { ScrapedPost, ScannerConfig, KeywordRule } from './types.ts';
import { formatRuleLabel } from './keyword-matcher.ts';

const TELEGRAM_MESSAGE_MAX = 4096;
const TELEGRAM_CAPTION_MAX = 1024;
const TELEGRAM_CONTENT_MAX = 3200;
const TELEGRAM_FETCH_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = TELEGRAM_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Telegram API timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function normalizeNewlines(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateForTelegram(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

export function getPrimaryImageUrl(post: ScrapedPost): string | undefined {
  return post.attachments.find((a) => a.type === 'image' && a.url)?.url;
}

export function formatTelegramMessage(
  post: ScrapedPost,
  maxContentLen = TELEGRAM_CONTENT_MAX,
): string {
  const plain = normalizeNewlines(post.text || '(no text)');
  const content = post.textHtml
    ? truncateForTelegram(post.textHtml, maxContentLen)
    : escapeHtml(truncateForTelegram(plain, maxContentLen));
  const safeAuthor = escapeHtml(post.author);
  const safeGroup = escapeHtml(post.groupName);
  const safeLink = escapeHtml(post.permalink);
  const dateStr = escapeHtml(new Date(post.createdAt).toLocaleString());

  const ruleLabel = post.matchedRuleName
    ? escapeHtml(post.matchedRuleName)
    : escapeHtml(post.matchedKeywords.join(' + '));

  const parts = [
    `<b>🔔 ${safeGroup}</b>`,
    '',
    content,
    '',
    '────────────',
    `<a href="${safeLink}">🔗 Open on Facebook</a>`,
    '',
    `<i>Rule:</i> ${ruleLabel}`,
    `<i>Keywords:</i> ${escapeHtml(post.matchedKeywords.join(', '))}`,
    `<i>Author:</i> ${safeAuthor}`,
    `<i>Date:</i> ${dateStr}`,
  ];

  return truncateForTelegram(parts.join('\n'), TELEGRAM_MESSAGE_MAX);
}

export function hasTelegramConfig(config: ScannerConfig): boolean {
  const { telegram } = config;
  return Boolean(
    telegram.enabled && telegram.botToken.trim() && telegram.chatId.trim(),
  );
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'Markdown' | undefined = 'HTML',
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: false,
  };
  if (parseMode) body.parse_mode = parseMode;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const resBody = await response.text();
    throw new Error(`Telegram API error ${response.status}: ${resBody}`);
  }
}

export async function sendTelegramPhoto(
  botToken: string,
  chatId: string,
  photoUrl: string,
  caption?: string,
  parseMode: 'HTML' | undefined = 'HTML',
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    photo: photoUrl,
  };
  if (caption) {
    body.caption = truncateForTelegram(caption, TELEGRAM_CAPTION_MAX);
    if (parseMode) body.parse_mode = parseMode;
  }

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 45_000);

  if (!response.ok) {
    const resBody = await response.text();
    throw new Error(`Telegram API error ${response.status}: ${resBody}`);
  }
}

export async function sendTelegramTest(botToken: string, chatId: string): Promise<void> {
  await sendTelegramMessage(
    botToken,
    chatId,
    '✅ FB Group Scanner — Telegram connection test successful!',
    undefined,
  );
}

export async function sendPostToTelegram(
  botToken: string,
  chatId: string,
  post: ScrapedPost,
): Promise<void> {
  const fullMessage = formatTelegramMessage(post);
  const imageUrl = getPrimaryImageUrl(post);

  if (!imageUrl) {
    console.log('[FB Scanner] Telegram — text only', post.id);
    await sendTelegramMessage(botToken, chatId, fullMessage, 'HTML');
    return;
  }

  if (fullMessage.length <= TELEGRAM_CAPTION_MAX) {
    try {
      console.log('[FB Scanner] Telegram — photo + caption', post.id);
      await sendTelegramPhoto(botToken, chatId, imageUrl, fullMessage, 'HTML');
      return;
    } catch (err) {
      console.warn('[FB Scanner] Telegram photo send failed, falling back to text:', err);
    }
  }

  console.log('[FB Scanner] Telegram — text + photo (long caption)', post.id);

  await sendTelegramMessage(botToken, chatId, fullMessage, 'HTML');

  const shortCaption = [
    `<b>📷 ${escapeHtml(post.groupName)}</b>`,
    `<a href="${escapeHtml(post.permalink)}">🔗 Open on Facebook</a>`,
  ].join('\n');

  try {
    await sendTelegramPhoto(botToken, chatId, imageUrl, shortCaption, 'HTML');
  } catch (err) {
    console.warn('Telegram photo send failed after text message:', err);
  }
}

export function formatRuleForDisplay(rule: KeywordRule): string {
  return formatRuleLabel(rule);
}

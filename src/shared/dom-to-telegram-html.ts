export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeTelegramHref(url: string): string {
  return url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function normalizeTelegramHtml(html: string): string {
  return html
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const BLOCK_TAGS = new Set([
  'DIV', 'P', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE',
]);

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'IMG', 'VIDEO', 'NOSCRIPT']);

function isBoldElement(el: Element): boolean {
  const tag = el.tagName;
  if (tag === 'STRONG' || tag === 'B') return true;
  const style = el.getAttribute('style') ?? '';
  return /font-weight:\s*(bold|[6-9]00)/i.test(style);
}

function isItalicElement(el: Element): boolean {
  const tag = el.tagName;
  if (tag === 'EM' || tag === 'I') return true;
  const style = el.getAttribute('style') ?? '';
  return /font-style:\s*italic/i.test(style);
}

function isSkippableElement(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if (el.getAttribute('role') === 'button') return true;
  const label = el.textContent?.trim().toLowerCase() ?? '';
  if (label === 'see more' || label === 'xem thêm' || label.startsWith('see more')) return true;
  return false;
}

interface FormatContext {
  bold: boolean;
  italic: boolean;
}

export function domElementToTelegramHtml(root: Element): string {
  const parts: string[] = [];

  function walkChildren(el: Element, ctx: FormatContext): void {
    for (const child of Array.from(el.childNodes)) {
      walk(child, ctx);
    }
  }

  function walk(node: Node, ctx: FormatContext): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text) parts.push(escapeTelegramHtml(text));
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    if (isSkippableElement(el)) return;

    const tag = el.tagName;

    if (tag === 'BR') {
      parts.push('\n');
      return;
    }

    if (tag === 'A') {
      const href = (el as HTMLAnchorElement).href;
      if (!href || href.startsWith('javascript:') || href === '#') {
        walkChildren(el, ctx);
        return;
      }
      parts.push(`<a href="${escapeTelegramHref(href)}">`);
      walkChildren(el, ctx);
      parts.push('</a>');
      return;
    }

    const openBold = !ctx.bold && isBoldElement(el);
    const openItalic = !ctx.italic && isItalicElement(el);
    const nextCtx: FormatContext = {
      bold: ctx.bold || isBoldElement(el),
      italic: ctx.italic || isItalicElement(el),
    };

    if (openBold) parts.push('<b>');
    if (openItalic) parts.push('<i>');

    walkChildren(el, nextCtx);

    if (openItalic) parts.push('</i>');
    if (openBold) parts.push('</b>');

    if (BLOCK_TAGS.has(tag)) {
      if (parts.length > 0 && parts[parts.length - 1] !== '\n') {
        parts.push('\n');
      }
    }
  }

  walk(root, { bold: false, italic: false });
  return normalizeTelegramHtml(parts.join(''));
}

export function plainTextLengthFromHtml(html: string): number {
  return html.replace(/<[^>]+>/g, '').length;
}

export function pickRicherTelegramHtml(a?: string, b?: string): string | undefined {
  if (!a) return b || undefined;
  if (!b) return a || undefined;
  return plainTextLengthFromHtml(a) >= plainTextLengthFromHtml(b) ? a : b;
}

export function normalizeGroupUrl(input: string): { id: string; url: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const patterns = [
    /facebook\.com\/groups\/(\d+)/i,
    /facebook\.com\/groups\/([^/?#]+)/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const id = match[1];
      return { id, url: `https://www.facebook.com/groups/${id}` };
    }
  }

  if (/^\d+$/.test(trimmed)) {
    return { id: trimmed, url: `https://www.facebook.com/groups/${trimmed}` };
  }

  if (/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    return { id: trimmed, url: `https://www.facebook.com/groups/${trimmed}` };
  }

  return null;
}

export interface ParseGroupLinesResult {
  added: { id: string; url: string }[];
  duplicates: string[];
  invalid: string[];
}

/** Parse multiline input — one group URL or slug per line. */
export function parseGroupLines(
  text: string,
  existingIds: Set<string>,
): ParseGroupLinesResult {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const added: { id: string; url: string }[] = [];
  const duplicates: string[] = [];
  const invalid: string[] = [];
  const pendingIds = new Set(existingIds);

  for (const line of lines) {
    const normalized = normalizeGroupUrl(line);
    if (!normalized) {
      invalid.push(line);
      continue;
    }
    if (pendingIds.has(normalized.id)) {
      duplicates.push(line);
      continue;
    }
    pendingIds.add(normalized.id);
    added.push(normalized);
  }

  return { added, duplicates, invalid };
}

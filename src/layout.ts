export const PAGE_MARGIN_X = 1;
export const CONTENT_MARGIN_X = 2;

const META_WIDTH = 76;

export function formatMeta(text: string): string {
  const normalized = text.replace(/\s*[│|]\s*/g, ' · ');
  if (normalized.length <= META_WIDTH) return normalized;
  return `${normalized.slice(0, META_WIDTH - 3)}...`;
}

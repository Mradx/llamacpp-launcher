export function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/\r?\n/g, ' ');
  if (maxLength <= 0) return '';
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 3) return '.'.repeat(maxLength);
  return `${normalized.slice(0, maxLength - 3)}...`;
}

export function clampLines(text: string, maxLines: number, maxLength = 80): string[] {
  if (maxLines <= 0) return [];

  const lines = text.split(/\r?\n/).map(line => truncateText(line, maxLength));
  if (lines.length <= maxLines) return lines;
  if (maxLines === 1) return [truncateText(`... ${lines.length} lines`, maxLength)];

  const remaining = lines.length - maxLines + 1;
  return [
    ...lines.slice(0, maxLines - 1),
    truncateText(`... ${remaining} more lines`, maxLength),
  ];
}

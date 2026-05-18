export function detectMtp(modelSource: string, fileName?: string): boolean {
  const combined = (modelSource + (fileName || '')).toLowerCase();
  return combined.includes('mtp');
}

import type { FitStatus } from './types.js';

export const theme = {
  logoText: '#ffffff',
  logoAccent: '#b1b9f9',
  accent: '#b1b9f9',
  accentStrong: '#b1b9f9',
  accentMuted: '#8f98db',
  accentDim: '#6871ad',
  border: '#8f98db',
  marker: '#b1b9f9',
  progress: '#b1b9f9',
  textMuted: '#a8a29e',
  warning: '#f59e0b',
  success: '#22c55e',
  danger: '#ef4444',
  neutral: '#78716c',
  ram: '#8f98db',
} as const;

export function fitStatusColor(status: FitStatus): string {
  switch (status) {
    case 'GPU_OK': return theme.success;
    case 'PARTIAL': return theme.warning;
    case 'RAM_OK': return theme.ram;
    case 'TOO_BIG': return theme.danger;
  }
}

export function usageColor(percent: number): string {
  if (percent > 95) return theme.danger;
  if (percent > 80) return theme.warning;
  return theme.progress;
}

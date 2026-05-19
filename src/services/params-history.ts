import { readFileSync, writeFileSync } from 'node:fs';
import type { ModelParams } from '../types.js';
import { getDataPath } from '../storage.js';

const HISTORY_FILE = 'params-history.json';
const MAX_ENTRIES = 3;

export interface CustomHistoryEntry {
  type: 'custom';
  params: ModelParams;
}

export interface ExpertHistoryEntry {
  type: 'expert';
  rawArgs: string[];
  raw: string;
}

export type HistoryEntry = CustomHistoryEntry | ExpertHistoryEntry;

interface HistoryData {
  recent: HistoryEntry[];
}

function getHistoryPath(): string {
  return getDataPath(HISTORY_FILE);
}

export function loadHistory(): HistoryEntry[] {
  try {
    const data: HistoryData = JSON.parse(readFileSync(getHistoryPath(), 'utf-8'));
    return (data.recent || []).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function entriesEqual(a: HistoryEntry, b: HistoryEntry): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'custom' && b.type === 'custom') {
    return JSON.stringify(a.params) === JSON.stringify(b.params);
  }
  if (a.type === 'expert' && b.type === 'expert') {
    return a.raw === b.raw;
  }
  return false;
}

export function saveToHistory(entry: HistoryEntry): void {
  const current = loadHistory().filter(e => !entriesEqual(e, entry));
  current.unshift(entry);
  const data: HistoryData = { recent: current.slice(0, MAX_ENTRIES) };
  writeFileSync(getHistoryPath(), JSON.stringify(data, null, 2), 'utf-8');
}

export function removeFromHistory(index: number): void {
  const current = loadHistory();
  if (index >= 0 && index < current.length) {
    current.splice(index, 1);
    const data: HistoryData = { recent: current };
    writeFileSync(getHistoryPath(), JSON.stringify(data, null, 2), 'utf-8');
  }
}

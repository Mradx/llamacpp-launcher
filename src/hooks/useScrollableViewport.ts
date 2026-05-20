import { useEffect, useMemo, useState } from 'react';
import { useTerminalViewport } from './useTerminalViewport.js';

export interface ScrollableViewportOptions {
  itemCount: number;
  selectedIndex: number;
  reservedRows?: number;
  minRows?: number;
  itemRows?: number;
  rows?: number;
}

export interface ScrollableViewport {
  start: number;
  end: number;
  visibleCount: number;
  hasAbove: boolean;
  hasBelow: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function useScrollableViewport({
  itemCount,
  selectedIndex,
  reservedRows = 0,
  minRows = 3,
  itemRows = 1,
  rows,
}: ScrollableViewportOptions): ScrollableViewport {
  const viewport = useTerminalViewport();
  const rawAvailableRows = Math.max(minRows, (rows ?? viewport.rows) - reservedRows);
  const availableRows = Math.max(1, Math.floor(rawAvailableRows / Math.max(1, itemRows)));
  const visibleCount = Math.max(0, Math.min(itemCount, availableRows));
  const [start, setStart] = useState(0);

  useEffect(() => {
    setStart(prev => {
      if (itemCount <= 0 || visibleCount <= 0) return 0;

      const selected = clamp(selectedIndex, 0, itemCount - 1);
      const maxStart = Math.max(0, itemCount - visibleCount);
      let next = clamp(prev, 0, maxStart);

      if (selected < next) {
        next = selected;
      } else if (selected >= next + visibleCount) {
        next = selected - visibleCount + 1;
      }

      return clamp(next, 0, maxStart);
    });
  }, [itemCount, selectedIndex, visibleCount]);

  return useMemo(() => {
    const safeStart = itemCount <= 0 || visibleCount <= 0
      ? 0
      : clamp(start, 0, Math.max(0, itemCount - visibleCount));
    const end = Math.min(itemCount, safeStart + visibleCount);
    return {
      start: safeStart,
      end,
      visibleCount,
      hasAbove: safeStart > 0,
      hasBelow: end < itemCount,
    };
  }, [itemCount, start, visibleCount]);
}

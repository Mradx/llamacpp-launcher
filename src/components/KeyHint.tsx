import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import { useTerminalViewport } from '../hooks/useTerminalViewport.js';

interface KeyHintProps {
  hints: Array<{ key: string; label: string }>;
}

export function KeyHint({ hints }: KeyHintProps) {
  const { columns } = useTerminalViewport();
  const maxWidth = Math.max(12, columns - 2);
  let usedWidth = 0;
  const visibleHints: Array<{ key: string; label: string }> = [];

  for (const hint of hints) {
    const hintWidth = hint.key.length + hint.label.length + 3;
    if (visibleHints.length > 0 && usedWidth + hintWidth > maxWidth) break;
    visibleHints.push(hint);
    usedWidth += hintWidth;
  }

  return (
    <Box marginTop={1} columnGap={2}>
      {visibleHints.map(h => (
        <Box key={h.key}>
          <Text color={theme.accent} bold>{h.key}</Text>
          <Text dimColor> {h.label}</Text>
        </Box>
      ))}
    </Box>
  );
}

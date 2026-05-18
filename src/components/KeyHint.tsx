import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

interface KeyHintProps {
  hints: Array<{ key: string; label: string }>;
}

export function KeyHint({ hints }: KeyHintProps) {
  return (
    <Box marginTop={1} columnGap={2}>
      {hints.map(h => (
        <Box key={h.key}>
          <Text color={theme.accent} bold>{h.key}</Text>
          <Text dimColor> {h.label}</Text>
        </Box>
      ))}
    </Box>
  );
}

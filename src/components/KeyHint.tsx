import React from 'react';
import { Box, Text } from 'ink';

interface KeyHintProps {
  hints: Array<{ key: string; label: string }>;
}

export function KeyHint({ hints }: KeyHintProps) {
  return (
    <Box marginTop={1} columnGap={2}>
      {hints.map(h => (
        <Box key={h.key}>
          <Text dimColor bold>{h.key}</Text>
          <Text dimColor> {h.label}</Text>
        </Box>
      ))}
    </Box>
  );
}

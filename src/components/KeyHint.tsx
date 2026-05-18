import React from 'react';
import { Box, Text } from 'ink';

interface KeyHintProps {
  hints: Array<{ key: string; label: string }>;
}

export function KeyHint({ hints }: KeyHintProps) {
  return (
    <Box marginTop={1}>
      <Text dimColor>
        {hints.map((h, i) => (
          <Text key={h.key}>
            {i > 0 ? '  ' : ''}
            <Text bold>{h.key}</Text> {h.label}
          </Text>
        ))}
      </Text>
    </Box>
  );
}

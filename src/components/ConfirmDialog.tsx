import React from 'react';
import { Box, Text, useInput } from 'ink';

interface ConfirmDialogProps {
  title: string;
  lines: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, lines, onConfirm, onCancel }: ConfirmDialogProps) {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y' || input === 'н' || input === 'Н') {
      onConfirm();
    } else if (input === 'n' || input === 'N' || input === 'т' || input === 'Т' || key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" marginLeft={2} marginTop={1}>
      <Text bold color="#ef4444">{title}</Text>
      <Box flexDirection="column" marginTop={1}>
        {lines.map((line, i) => (
          <Text key={i} dimColor={i > 0}>{line}</Text>
        ))}
      </Box>
      <Box marginTop={1} columnGap={2}>
        <Box>
          <Text dimColor bold>y</Text>
          <Text dimColor> confirm</Text>
        </Box>
        <Box>
          <Text dimColor bold>n/esc</Text>
          <Text dimColor> cancel</Text>
        </Box>
      </Box>
    </Box>
  );
}

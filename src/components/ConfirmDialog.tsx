import React from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../theme.js';
import { useTerminalViewport } from '../hooks/useTerminalViewport.js';
import { clampLines, truncateText } from '../utils/terminal.js';

interface ConfirmDialogProps {
  title: string;
  lines: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, lines, onConfirm, onCancel }: ConfirmDialogProps) {
  const { rows, columns } = useTerminalViewport();
  const maxLineWidth = Math.max(20, columns - 6);
  const visibleLines = clampLines(lines.join('\n'), Math.max(1, rows - 12), maxLineWidth);

  useInput((input, key) => {
    if (input === 'y' || input === 'Y' || input === 'н' || input === 'Н') {
      onConfirm();
    } else if (input === 'n' || input === 'N' || input === 'т' || input === 'Т' || key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" marginLeft={2} marginTop={1}>
      <Text bold color={theme.danger}>{truncateText(title, maxLineWidth)}</Text>
      <Box flexDirection="column" marginTop={1}>
        {visibleLines.map((line, i) => (
          <Text key={`${i}-${line}`} dimColor={i > 0}>{line || ' '}</Text>
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

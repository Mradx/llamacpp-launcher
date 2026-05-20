import React from 'react';
import { Box, Text } from 'ink';
import { formatMeta } from '../layout.js';
import { theme } from '../theme.js';
import { useTerminalViewport } from '../hooks/useTerminalViewport.js';
import { truncateText } from '../utils/terminal.js';

interface TitleBlockProps {
  title: string;
  subtitle?: string;
  marginBottom?: number;
}

export function TitleBlock({ title, subtitle, marginBottom = 1 }: TitleBlockProps) {
  const { columns } = useTerminalViewport();
  const maxTextWidth = Math.max(20, columns - 6);
  const displaySubtitle = subtitle
    ? truncateText(formatMeta(subtitle), maxTextWidth)
    : undefined;

  return (
    <Box flexDirection="column" marginBottom={marginBottom}>
      <Box>
        <Text color={theme.accentStrong} bold>▌ </Text>
        <Text color={theme.logoText} bold>{truncateText(title, maxTextWidth)}</Text>
      </Box>
      {displaySubtitle && (
        <Box marginLeft={2}>
          <Text color={theme.textMuted}>{displaySubtitle}</Text>
        </Box>
      )}
    </Box>
  );
}

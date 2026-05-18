import React from 'react';
import { Box, Text } from 'ink';
import { formatMeta } from '../layout.js';
import { theme } from '../theme.js';

interface TitleBlockProps {
  title: string;
  subtitle?: string;
  marginBottom?: number;
}

export function TitleBlock({ title, subtitle, marginBottom = 1 }: TitleBlockProps) {
  return (
    <Box flexDirection="column" marginBottom={marginBottom}>
      <Box>
        <Text color={theme.accentStrong} bold>▌ </Text>
        <Text color={theme.logoText} bold>{title}</Text>
      </Box>
      {subtitle && (
        <Box marginLeft={2}>
          <Text color={theme.textMuted}>{formatMeta(subtitle)}</Text>
        </Box>
      )}
    </Box>
  );
}

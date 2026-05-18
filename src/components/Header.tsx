import React from 'react';
import { Box, Text } from 'ink';
import gradient from 'gradient-string';

interface HeaderProps {
  title: string;
  subtitle?: string;
}

const coolGradient = gradient(['#6366f1', '#8b5cf6', '#d946ef']);

export function Header({ title, subtitle }: HeaderProps) {
  const rendered = coolGradient(title);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box
        borderStyle="round"
        borderColor="#6366f1"
        paddingX={2}
        paddingY={0}
      >
        <Text>{rendered}</Text>
      </Box>
      {subtitle && (
        <Box marginLeft={2}>
          <Text dimColor>{subtitle}</Text>
        </Box>
      )}
    </Box>
  );
}

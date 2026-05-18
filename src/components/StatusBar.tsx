import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { theme } from '../theme.js';

interface StatusBarProps {
  status: 'idle' | 'starting' | 'running' | 'stopped' | 'error';
  message?: string;
}

export function StatusBar({ status, message }: StatusBarProps) {
  let indicator: React.ReactNode;
  let color: string;

  switch (status) {
    case 'starting':
      indicator = <Spinner type="dots" />;
      color = theme.warning;
      break;
    case 'running':
      indicator = <Text>●</Text>;
      color = theme.success;
      break;
    case 'stopped':
      indicator = <Text>■</Text>;
      color = theme.neutral;
      break;
    case 'error':
      indicator = <Text>✖</Text>;
      color = theme.danger;
      break;
    default:
      indicator = <Text>○</Text>;
      color = theme.neutral;
  }

  const statusLabel = status.toUpperCase();
  const displayMsg = message || statusLabel;

  return (
    <Box>
      <Text color={color}>{indicator} </Text>
      <Text color={color} bold>{displayMsg}</Text>
    </Box>
  );
}

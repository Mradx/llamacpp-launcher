import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

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
      color = '#eab308';
      break;
    case 'running':
      indicator = <Text>●</Text>;
      color = '#22c55e';
      break;
    case 'stopped':
      indicator = <Text>■</Text>;
      color = '#6b7280';
      break;
    case 'error':
      indicator = <Text>✖</Text>;
      color = '#ef4444';
      break;
    default:
      indicator = <Text>○</Text>;
      color = '#6b7280';
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

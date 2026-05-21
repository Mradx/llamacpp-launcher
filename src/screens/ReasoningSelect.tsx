import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { useTerminalViewport } from '../hooks/useTerminalViewport.js';
import { truncateText } from '../utils/terminal.js';
import type { ReasoningMode } from '../types.js';
import { theme } from '../theme.js';

interface ReasoningChoice {
  mode: ReasoningMode;
  name: string;
  desc: string;
}

const CHOICES: ReasoningChoice[] = [
  {
    mode: 'auto',
    name: 'Auto',
    desc: 'llama.cpp detects thinking support from the chat template',
  },
  {
    mode: 'on',
    name: 'On',
    desc: 'force reasoning/thinking for supported models',
  },
  {
    mode: 'off',
    name: 'Off',
    desc: 'disable reasoning/thinking for this launch',
  },
];

interface ReasoningSelectProps {
  initialMode?: ReasoningMode;
  onSelect: (mode: ReasoningMode) => void;
  onBack: () => void;
  initialSelectedIndex?: number;
  onSelectedIndexChange?: (selectedIndex: number) => void;
}

function resolveInitialIndex(mode?: ReasoningMode): number {
  const index = CHOICES.findIndex(choice => choice.mode === mode);
  return index >= 0 ? index : 0;
}

export function ReasoningSelect({
  initialMode,
  onSelect,
  onBack,
  initialSelectedIndex,
  onSelectedIndexChange,
}: ReasoningSelectProps) {
  const [selectedIndex, setSelectedIndex] = useState(() => (
    Math.min(initialSelectedIndex ?? resolveInitialIndex(initialMode), CHOICES.length - 1)
  ));
  const { columns } = useTerminalViewport();
  const maxLineWidth = Math.max(24, columns - 10);

  useEffect(() => {
    onSelectedIndexChange?.(selectedIndex);
  }, [onSelectedIndexChange, selectedIndex]);

  useInput((_, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(CHOICES.length - 1, i + 1));
    } else if (key.return) {
      onSelect(CHOICES[selectedIndex].mode);
    }
  });

  return (
    <Box flexDirection="column">
      <Header title="REASONING" subtitle="Choose llama-server thinking mode" />

      <Box flexDirection="column" marginLeft={2}>
        {CHOICES.map((choice, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Box key={choice.mode} flexDirection="column">
              <Box>
                <Text color={isSelected ? theme.marker : undefined}>
                  {isSelected ? ' › ' : '   '}
                </Text>
                <Box width={4}>
                  <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
                    {index + 1}.
                  </Text>
                </Box>
                <Text color={isSelected ? 'white' : undefined} bold={isSelected}>
                  {choice.name}
                </Text>
              </Box>
              <Box marginLeft={8}>
                <Text dimColor>{truncateText(choice.desc, maxLineWidth)}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box marginLeft={2}>
        <KeyHint hints={[
          { key: '↑↓', label: 'navigate' },
          { key: '⏎', label: 'select' },
          { key: 'esc', label: 'back' },
        ]} />
      </Box>
    </Box>
  );
}

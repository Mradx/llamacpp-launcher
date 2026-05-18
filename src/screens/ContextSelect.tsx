import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { formatNumber } from '../utils/format.js';

interface ContextSelectProps {
  options: number[];
  defaultContext: number;
  onSelect: (ctx: number) => void;
  onBack: () => void;
}

const descriptions: Record<number, string> = {
  4096: 'small, fast',
  20000: 'standard',
  64000: 'default',
  96000: 'large',
  128000: 'maximum',
};

export function ContextSelect({ options, defaultContext, onSelect, onBack }: ContextSelectProps) {
  const defaultIdx = options.indexOf(defaultContext);
  const [selectedIndex, setSelectedIndex] = useState(defaultIdx >= 0 ? defaultIdx : 2);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(options.length - 1, i + 1));
    } else if (key.return) {
      onSelect(options[selectedIndex]);
    }
  });

  return (
    <Box flexDirection="column">
      <Header title="CONTEXT SIZE" />

      <Box flexDirection="column" marginLeft={2}>
        {options.map((ctx, i) => {
          const isSelected = i === selectedIndex;
          const isDefault = ctx === defaultContext;
          const desc = descriptions[ctx] || '';

          return (
            <Box key={ctx}>
              <Text color={isSelected ? '#d946ef' : undefined}>
                {isSelected ? ' › ' : '   '}
              </Text>
              <Box width={4}>
                <Text color={isSelected ? 'white' : '#a1a1aa'} bold={isSelected}>
                  {i + 1}.
                </Text>
              </Box>
              <Box width={16}>
                <Text color={isSelected ? 'white' : undefined} bold={isSelected}>
                  {formatNumber(ctx).padStart(7)} tokens
                </Text>
              </Box>
              <Text dimColor>  ({desc}){isDefault ? ' ★' : ''}</Text>
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

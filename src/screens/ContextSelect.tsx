import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { formatNumber } from '../utils/format.js';
import { calculateFit } from '../services/memory.js';
import type { FitStatus, HardwareInfo } from '../types.js';
import { fitStatusColor, theme } from '../theme.js';

interface ContextSelectProps {
  options: number[];
  defaultContext: number;
  modelSizeBytes?: number;
  totalLayers?: number;
  hardware?: HardwareInfo | null;
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

function fitLabel(status: FitStatus): string {
  switch (status) {
    case 'GPU_OK': return 'GPU OK';
    case 'PARTIAL': return 'PARTIAL';
    case 'RAM_OK': return 'RAM OK';
    case 'TOO_BIG': return 'TOO BIG';
  }
}

export function ContextSelect({ options, defaultContext, modelSizeBytes, totalLayers, hardware, onSelect, onBack }: ContextSelectProps) {
  const defaultIdx = options.indexOf(defaultContext);
  const [selectedIndex, setSelectedIndex] = useState(defaultIdx >= 0 ? defaultIdx : 2);

  const canShowFit = !!(modelSizeBytes && hardware);

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

          let fit: ReturnType<typeof calculateFit> | null = null;
          if (canShowFit) {
            fit = calculateFit(modelSizeBytes!, ctx, hardware!.vramMb, hardware!.ramMb, totalLayers);
          }

          return (
            <Box key={ctx}>
              <Text color={isSelected ? theme.marker : undefined}>
                {isSelected ? ' › ' : '   '}
              </Text>
              <Box width={4}>
                <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
                  {i + 1}.
                </Text>
              </Box>
              <Box width={16}>
                <Text color={isSelected ? 'white' : undefined} bold={isSelected}>
                  {formatNumber(ctx).padStart(7)} tokens
                </Text>
              </Box>
              <Box width={18}>
                <Text dimColor>  ({desc}){isDefault ? ' ★' : ''}</Text>
              </Box>
              {fit && (
                <Text color={fitStatusColor(fit.fitStatus)} bold={isSelected}>
                  {'  '}{fitLabel(fit.fitStatus)}
                </Text>
              )}
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

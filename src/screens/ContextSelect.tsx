import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { formatNumber } from '../utils/format.js';
import { truncateText } from '../utils/terminal.js';
import { calculateFit } from '../services/memory.js';
import { useScrollableViewport } from '../hooks/useScrollableViewport.js';
import { useTerminalViewport } from '../hooks/useTerminalViewport.js';
import type { FitStatus, HardwareInfo, ModelMetadata } from '../types.js';
import { fitStatusColor, theme } from '../theme.js';

interface ContextSelectProps {
  options: number[];
  modelSizeBytes?: number;
  metadata?: ModelMetadata;
  hardware?: HardwareInfo | null;
  onSelect: (ctx: number) => void;
  onBack: () => void;
  initialSelectedIndex?: number;
  onSelectedIndexChange?: (selectedIndex: number) => void;
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

export function ContextSelect({
  options,
  modelSizeBytes,
  metadata,
  hardware,
  onSelect,
  onBack,
  initialSelectedIndex,
  onSelectedIndexChange,
}: ContextSelectProps) {
  const suggestedIdx = Math.floor(options.length / 2);
  const [selectedIndex, setSelectedIndex] = useState(() => (
    Math.min(initialSelectedIndex ?? suggestedIdx, Math.max(0, options.length - 1))
  ));
  const { columns } = useTerminalViewport();
  const listViewport = useScrollableViewport({
    itemCount: options.length,
    selectedIndex,
    reservedRows: 8,
    minRows: 4,
  });
  const visibleOptions = options.slice(listViewport.start, listViewport.end);
  const descWidth = Math.max(12, Math.min(18, columns - 42));

  const canShowFit = !!(modelSizeBytes && hardware);

  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(0, options.length - 1)));
  }, [options.length]);

  useEffect(() => {
    onSelectedIndexChange?.(selectedIndex);
  }, [onSelectedIndexChange, selectedIndex]);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (options.length === 0) return;
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
        {listViewport.hasAbove && <Text dimColor>  ... more above</Text>}
        {visibleOptions.map((ctx, offset) => {
          const i = listViewport.start + offset;
          const isSelected = i === selectedIndex;
          const isDefault = i === suggestedIdx;
          const desc = descriptions[ctx] || '';

          let fit: ReturnType<typeof calculateFit> | null = null;
          if (canShowFit) {
            fit = calculateFit(modelSizeBytes!, ctx, hardware!.vramMb, hardware!.ramMb, metadata, hardware!.unifiedMemory);
          }
          const exceedsTrainContext = !!(metadata?.contextLength && ctx > metadata.contextLength);

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
              <Box width={descWidth + 4}>
                <Text dimColor>  ({truncateText(desc, descWidth)}){isDefault ? ' ★' : ''}</Text>
              </Box>
              {exceedsTrainContext && (
                <Box width={8}>
                  <Text color={theme.warning} bold={isSelected}>  RISKY</Text>
                </Box>
              )}
              {fit && (
                <Text color={fitStatusColor(fit.fitStatus)} bold={isSelected}>
                  {'  '}{fitLabel(fit.fitStatus)}
                </Text>
              )}
            </Box>
          );
        })}
        {listViewport.hasBelow && <Text dimColor>  ... more below</Text>}
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

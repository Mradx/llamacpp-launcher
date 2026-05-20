import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import type { ModelParams } from '../types.js';
import { theme } from '../theme.js';

interface ParamField {
  key: keyof ModelParams;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

const FIELDS: ParamField[] = [
  { key: 'temp', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.8 },
  { key: 'top_k', label: 'Top K', min: 0, max: 100, step: 1, default: 40 },
  { key: 'top_p', label: 'Top P', min: 0, max: 1, step: 0.05, default: 0.95 },
  { key: 'min_p', label: 'Min P', min: 0, max: 1, step: 0.01, default: 0.05 },
  { key: 'presence_penalty', label: 'Presence Penalty', min: 0, max: 2, step: 0.1, default: 0 },
  { key: 'frequency_penalty', label: 'Frequency Penalty', min: 0, max: 2, step: 0.1, default: 0 },
  { key: 'repeat_penalty', label: 'Repeat Penalty', min: 1, max: 2, step: 0.05, default: 1 },
];

interface CustomParamsProps {
  onConfirm: (params: ModelParams) => void;
  onBack: () => void;
  initialSelectedIndex?: number;
  onSelectedIndexChange?: (selectedIndex: number) => void;
}

export function CustomParams({
  onConfirm,
  onBack,
  initialSelectedIndex,
  onSelectedIndexChange,
}: CustomParamsProps) {
  const [selectedIndex, setSelectedIndex] = useState(() => (
    Math.min(initialSelectedIndex ?? 0, FIELDS.length)
  ));
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(FIELDS.map(f => [f.key, f.default]))
  );

  useEffect(() => {
    onSelectedIndexChange?.(selectedIndex);
  }, [onSelectedIndexChange, selectedIndex]);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(FIELDS.length, i + 1));
    } else if (key.leftArrow) {
      if (selectedIndex < FIELDS.length) {
        const field = FIELDS[selectedIndex];
        setValues(prev => ({
          ...prev,
          [field.key]: Math.max(field.min, round(prev[field.key] - field.step, field.step)),
        }));
      }
    } else if (key.rightArrow) {
      if (selectedIndex < FIELDS.length) {
        const field = FIELDS[selectedIndex];
        setValues(prev => ({
          ...prev,
          [field.key]: Math.min(field.max, round(prev[field.key] + field.step, field.step)),
        }));
      }
    } else if (key.return) {
      if (selectedIndex === FIELDS.length) {
        const params: ModelParams = {};
        for (const field of FIELDS) {
          if (values[field.key] !== field.default) {
            (params as any)[field.key] = values[field.key];
          }
        }
        onConfirm(Object.keys(params).length > 0 ? params : {});
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Header title="CUSTOM PARAMETERS" subtitle="← → adjust value, ↑↓ navigate" />

      <Box flexDirection="column" marginLeft={2}>
        {FIELDS.map((field, i) => {
          const isSelected = i === selectedIndex;
          const value = values[field.key];
          const isDefault = value === field.default;
          const barWidth = 20;
          const ratio = (value - field.min) / (field.max - field.min);
          const filled = Math.round(ratio * barWidth);

          return (
            <Box key={field.key} marginBottom={0}>
              <Text color={isSelected ? theme.marker : undefined}>
                {isSelected ? ' › ' : '   '}
              </Text>
              <Box width={20}>
                <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
                  {field.label}
                </Text>
              </Box>
              <Box width={3}>
                <Text color={isSelected ? theme.accent : theme.neutral}>{'◂'}</Text>
              </Box>
              <Box width={barWidth + 2}>
                <Text color={theme.progress}>{'█'.repeat(filled)}</Text>
                <Text dimColor>{'░'.repeat(barWidth - filled)}</Text>
              </Box>
              <Box width={3}>
                <Text color={isSelected ? theme.accent : theme.neutral}>{'▸'}</Text>
              </Box>
              <Box width={8}>
                <Text color={isSelected ? 'white' : undefined} bold={isSelected}>
                  {formatValue(value, field.step)}
                </Text>
              </Box>
              {!isDefault && <Text color={theme.warning}> *</Text>}
            </Box>
          );
        })}

        <Box marginTop={1}>
          <Text color={selectedIndex === FIELDS.length ? theme.marker : undefined}>
            {selectedIndex === FIELDS.length ? ' › ' : '   '}
          </Text>
          <Text color={selectedIndex === FIELDS.length ? theme.success : theme.textMuted} bold={selectedIndex === FIELDS.length}>
            ✓ Confirm and launch
          </Text>
        </Box>
      </Box>

      <Box marginLeft={2}>
        <KeyHint hints={[
          { key: '←→', label: 'adjust' },
          { key: '↑↓', label: 'navigate' },
          { key: '⏎', label: 'confirm' },
          { key: 'esc', label: 'back' },
        ]} />
      </Box>
    </Box>
  );
}

function round(value: number, step: number): number {
  const decimals = step < 1 ? (step < 0.1 ? 2 : 1) : 0;
  return parseFloat(value.toFixed(decimals));
}

function formatValue(value: number, step: number): string {
  if (step >= 1) return String(Math.round(value));
  if (step >= 0.1) return value.toFixed(1);
  return value.toFixed(2);
}

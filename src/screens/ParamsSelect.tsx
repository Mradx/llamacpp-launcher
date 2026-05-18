import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { loadHistory, removeFromHistory } from '../services/params-history.js';
import type { ParamsProfile, ModelParams } from '../types.js';
import { theme } from '../theme.js';

type SelectAction =
  | { type: 'preset'; params: ModelParams | null }
  | { type: 'custom' }
  | { type: 'expert' }
  | { type: 'recent-expert'; rawArgs: string[] };

interface ParamsSelectProps {
  presetName: string;
  profiles: ParamsProfile[];
  onSelect: (params: ModelParams | null) => void;
  onCustom: () => void;
  onExpert: () => void;
  onExpertDirect: (rawArgs: string[]) => void;
  onBack: () => void;
}

function formatParamsRaw(params: ModelParams): string {
  const parts: string[] = [];
  if (params.temp !== undefined) parts.push(`--temp ${params.temp}`);
  if (params.top_k !== undefined) parts.push(`--top-k ${params.top_k}`);
  if (params.top_p !== undefined) parts.push(`--top-p ${params.top_p}`);
  if (params.min_p !== undefined) parts.push(`--min-p ${params.min_p}`);
  if (params.presence_penalty !== undefined) parts.push(`--presence-penalty ${params.presence_penalty}`);
  if (params.frequency_penalty !== undefined) parts.push(`--frequency-penalty ${params.frequency_penalty}`);
  if (params.repeat_penalty !== undefined) parts.push(`--repeat-penalty ${params.repeat_penalty}`);
  return parts.join(' ');
}

export function ParamsSelect({ presetName, profiles, onSelect, onCustom, onExpert, onExpertDirect, onBack }: ParamsSelectProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [history, setHistory] = useState(() => loadHistory());

  const recentStart = profiles.length;

  const recentItems: Array<{ name: string; desc: string; action: SelectAction }> = history.map(entry => {
    if (entry.type === 'custom') {
      return {
        name: '↻ Custom',
        desc: formatParamsRaw(entry.params),
        action: { type: 'preset' as const, params: entry.params },
      };
    }
    return {
      name: '↻ Expert',
      desc: entry.raw,
      action: { type: 'recent-expert' as const, rawArgs: entry.rawArgs },
    };
  });

  const items: Array<{ name: string; desc?: string; action: SelectAction }> = [
    ...profiles.map(p => ({
      name: p.name,
      desc: formatParamsRaw(p.params),
      action: { type: 'preset' as const, params: p.params },
    })),
    ...recentItems,
    { name: 'Custom (interactive)', desc: 'adjust parameters with visual sliders', action: { type: 'custom' } },
    { name: 'Expert (raw flags)', desc: 'type llama-server CLI flags directly', action: { type: 'expert' } },
    { name: 'llama.cpp defaults', desc: 'no sampling params specified', action: { type: 'preset', params: null } },
  ];

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(items.length - 1, i + 1));
    } else if (input === 'd' || input === 'D' || input === 'в' || input === 'В') {
      const historyIndex = selectedIndex - recentStart;
      if (historyIndex >= 0 && historyIndex < history.length) {
        removeFromHistory(historyIndex);
        setHistory(prev => prev.filter((_, i) => i !== historyIndex));
        setSelectedIndex(i => Math.min(i, items.length - 2));
      }
      return;
    } else if (key.return) {
      const action = items[selectedIndex].action;
      if (action.type === 'preset') {
        onSelect(action.params);
      } else if (action.type === 'custom') {
        onCustom();
      } else if (action.type === 'expert') {
        onExpert();
      } else if (action.type === 'recent-expert') {
        onExpertDirect(action.rawArgs);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Header title="SAMPLING PARAMETERS" subtitle={`Preset: ${presetName}`} />

      <Box flexDirection="column" marginLeft={2}>
        {items.map((item, i) => {
          const isSelected = i === selectedIndex;

          return (
            <Box key={`${item.name}-${i}`} flexDirection="column" marginBottom={item.desc ? 1 : 0}>
              <Box>
                <Text color={isSelected ? theme.marker : undefined}>
                  {isSelected ? ' › ' : '   '}
                </Text>
                <Box width={4}>
                  <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
                    {i + 1}.
                  </Text>
                </Box>
                <Text color={isSelected ? 'white' : undefined} bold={isSelected}>
                  {item.name}
                </Text>
              </Box>
              {item.desc && (
                <Box marginLeft={8}>
                  <Text dimColor>{item.desc}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginLeft={2}>
        <KeyHint hints={[
          { key: '↑↓', label: 'navigate' },
          { key: '⏎', label: 'select' },
          ...(selectedIndex >= recentStart && selectedIndex < recentStart + history.length
            ? [{ key: 'd', label: 'delete' }]
            : []),
          { key: 'esc', label: 'back' },
        ]} />
      </Box>
    </Box>
  );
}

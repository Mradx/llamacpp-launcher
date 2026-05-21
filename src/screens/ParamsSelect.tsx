import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { loadHistory, removeFromHistory, type HistoryEntry } from '../services/params-history.js';
import { resolveSamplingPreferenceIndex, type SamplingPreference } from '../services/model-preferences.js';
import { useScrollableViewport } from '../hooks/useScrollableViewport.js';
import { useTerminalViewport } from '../hooks/useTerminalViewport.js';
import { truncateText } from '../utils/terminal.js';
import type { ParamsProfile, ModelParams } from '../types.js';
import { theme } from '../theme.js';

type SelectAction =
  | { type: 'preset'; params: ModelParams; preference: SamplingPreference }
  | { type: 'defaults'; preference: SamplingPreference }
  | { type: 'recent-custom'; params: ModelParams; preference: SamplingPreference }
  | { type: 'custom' }
  | { type: 'expert' }
  | { type: 'recent-expert'; rawArgs: string[]; preference: SamplingPreference };

interface ParamsSelectProps {
  presetName: string;
  profiles: ParamsProfile[];
  hasTemplate: boolean;
  hasTemplateOverride: boolean;
  onSelect: (params: ModelParams | null, preference: SamplingPreference) => void;
  onCustom: () => void;
  onExpert: () => void;
  onExpertDirect: (rawArgs: string[], preference: SamplingPreference) => void;
  onTemplate: () => void;
  onBack: () => void;
  initialSelectedIndex?: number;
  initialSamplingPreference?: SamplingPreference;
  onSelectedIndexChange?: (selectedIndex: number) => void;
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

export function ParamsSelect({
  presetName,
  profiles,
  hasTemplate,
  hasTemplateOverride,
  onSelect,
  onCustom,
  onExpert,
  onExpertDirect,
  onTemplate,
  onBack,
  initialSelectedIndex,
  initialSamplingPreference,
  onSelectedIndexChange,
}: ParamsSelectProps) {
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const { columns } = useTerminalViewport();

  const recentStart = profiles.length;

  const recentItems: Array<{ name: string; desc: string; action: SelectAction; preference: SamplingPreference }> = history.map(entry => {
    if (entry.type === 'custom') {
      const preference: SamplingPreference = { type: 'custom', params: entry.params };
      return {
        name: '↻ Custom',
        desc: formatParamsRaw(entry.params),
        action: { type: 'recent-custom' as const, params: entry.params, preference },
        preference,
      };
    }
    const preference: SamplingPreference = { type: 'expert', rawArgs: entry.rawArgs };
    return {
      name: '↻ Expert',
      desc: entry.raw,
      action: { type: 'recent-expert' as const, rawArgs: entry.rawArgs, preference },
      preference,
    };
  });

  const items: Array<{ name: string; desc?: string; action: SelectAction; preference?: SamplingPreference }> = [
    ...profiles.map(p => ({
      name: p.name,
      desc: formatParamsRaw(p.params),
      action: {
        type: 'preset' as const,
        params: p.params,
        preference: { type: 'profile' as const, profileName: p.name },
      },
      preference: { type: 'profile' as const, profileName: p.name },
    })),
    ...recentItems,
    { name: 'Custom (interactive)', desc: 'adjust parameters with visual sliders', action: { type: 'custom' } },
    { name: 'Expert (raw flags)', desc: 'type llama-server CLI flags directly', action: { type: 'expert' } },
    {
      name: 'llama.cpp defaults',
      desc: 'no sampling params specified',
      action: { type: 'defaults', preference: { type: 'defaults' } },
      preference: { type: 'defaults' },
    },
  ];
  const preferredIndex = initialSelectedIndex
    ?? resolveSamplingPreferenceIndex(items, initialSamplingPreference)
    ?? 0;
  const [selectedIndex, setSelectedIndex] = useState(() => preferredIndex);
  const listViewport = useScrollableViewport({
    itemCount: items.length,
    selectedIndex,
    reservedRows: hasTemplate || hasTemplateOverride ? 11 : 9,
    minRows: 4,
    itemRows: 2,
  });
  const visibleItems = items.slice(listViewport.start, listViewport.end);
  const maxLineWidth = Math.max(24, columns - 10);

  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

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
      setSelectedIndex(i => Math.min(items.length - 1, i + 1));
    } else if (input === 't' || input === 'T' || input === '\u0435' || input === '\u0415') {
      onTemplate();
      return;
    } else if (input === 'd' || input === 'D' || input === '\u0432' || input === '\u0412') {
      const historyIndex = selectedIndex - recentStart;
      if (historyIndex >= 0 && historyIndex < history.length) {
        removeFromHistory(historyIndex);
        setHistory(prev => prev.filter((_, i) => i !== historyIndex));
        setSelectedIndex(i => Math.min(i, Math.max(0, items.length - 2)));
      }
      return;
    } else if (key.return) {
      const action = items[selectedIndex]?.action;
      if (!action) return;
      if (action.type === 'preset') {
        onSelect(action.params, action.preference);
      } else if (action.type === 'defaults') {
        onSelect(null, action.preference);
      } else if (action.type === 'recent-custom') {
        onSelect(action.params, action.preference);
      } else if (action.type === 'custom') {
        onCustom();
      } else if (action.type === 'expert') {
        onExpert();
      } else if (action.type === 'recent-expert') {
        onExpertDirect(action.rawArgs, action.preference);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Header title="SAMPLING PARAMETERS" subtitle={`Preset: ${presetName}`} />

      <Box flexDirection="column" marginLeft={2}>
        {listViewport.hasAbove && <Text dimColor>  ... more above</Text>}
        {visibleItems.map((item, offset) => {
          const i = listViewport.start + offset;
          const isSelected = i === selectedIndex;

          return (
            <Box key={`${item.name}-${i}`} flexDirection="column">
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
                  {truncateText(item.name, maxLineWidth)}
                </Text>
              </Box>
              {item.desc && (
                <Box marginLeft={8}>
                  <Text dimColor>{truncateText(item.desc, maxLineWidth)}</Text>
                </Box>
              )}
            </Box>
          );
        })}
        {listViewport.hasBelow && <Text dimColor>  ... more below</Text>}
      </Box>

      {(hasTemplate || hasTemplateOverride) && (
        <Box marginLeft={2} marginTop={1}>
          <Text dimColor>Chat Template: </Text>
          {hasTemplateOverride
            ? <Text color={theme.warning}>custom override</Text>
            : <Text color={theme.success}>model default</Text>
          }
        </Box>
      )}

      <Box marginLeft={2}>
        <KeyHint hints={[
          { key: '↑↓', label: 'navigate' },
          { key: '⏎', label: 'select' },
          { key: 't', label: 'template' },
          ...(selectedIndex >= recentStart && selectedIndex < recentStart + history.length
            ? [{ key: 'd', label: 'delete' }]
            : []),
          { key: 'esc', label: 'back' },
        ]} />
      </Box>
    </Box>
  );
}

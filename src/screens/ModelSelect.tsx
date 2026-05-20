import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { CONTENT_MARGIN_X, PAGE_MARGIN_X } from '../layout.js';
import { formatSize } from '../utils/format.js';
import { truncateText } from '../utils/terminal.js';
import { getSiblingModels } from '../services/models.js';
import { useScrollableViewport } from '../hooks/useScrollableViewport.js';
import { useTerminalViewport } from '../hooks/useTerminalViewport.js';
import type { LocalModel, ModelMetadata, ModelSelection } from '../types.js';
import type { VersionInfo } from '../services/llamacpp-version.js';
import { theme } from '../theme.js';

interface ModelSelectProps {
  models: LocalModel[];
  loading: boolean;
  hfCachePath: string;
  version?: VersionInfo | null;
  onSelect: (model: ModelSelection) => void;
  onDelete: (model: LocalModel) => void;
  onRefresh: () => void;
  onQuit: () => void;
  onSettings: () => void;
  initialSelectedIndex?: number;
  onSelectedIndexChange?: (index: number) => void;
}

interface ModelGroup {
  repoId: string;
  name: string;
  models: LocalModel[];
  sharedMeta: string;
}

type FlatItem =
  | { type: 'single'; model: LocalModel }
  | { type: 'group'; group: ModelGroup }
  | { type: 'child'; model: LocalModel; isLast: boolean }
  | { type: 'hf' }
  | { type: 'settings' };

const MODEL_ITEM_ROWS = 4;

function metadataSummary(metadata?: ModelMetadata, fileName?: string): string {
  if (!metadata) return 'metadata estimated';
  const hasMtp = metadata.nextNPredictLayers
    ? metadata.nextNPredictLayers > 0
    : (fileName ?? '').toLowerCase().includes('mtp');
  return [
    metadata.architecture,
    metadata.sizeLabel,
    metadata.primaryQuantType,
    metadata.blockCount ? `${metadata.blockCount} layers` : undefined,
    hasMtp ? 'MTP' : undefined,
    metadata.isEstimated ? 'estimated' : undefined,
  ].filter(Boolean).join(' · ');
}

function groupModels(models: LocalModel[]): ModelGroup[] {
  const map = new Map<string, LocalModel[]>();
  const order: string[] = [];
  for (const m of models) {
    if (!map.has(m.repoId)) {
      map.set(m.repoId, []);
      order.push(m.repoId);
    }
    map.get(m.repoId)!.push(m);
  }
  return order.map(repoId => {
    const items = map.get(repoId)!;
    const md = items[0].metadata;
    const name = md?.baseName || md?.name || repoId;
    const sharedMeta = [
      md?.architecture,
      md?.sizeLabel,
      md?.blockCount ? `${md.blockCount} layers` : undefined,
    ].filter(Boolean).join(' · ');
    return { repoId, name, models: items, sharedMeta };
  });
}

function buildFlatItems(groups: ModelGroup[], expanded: Set<string>): FlatItem[] {
  const items: FlatItem[] = [];
  for (const group of groups) {
    if (group.models.length === 1) {
      items.push({ type: 'single', model: group.models[0] });
    } else {
      items.push({ type: 'group', group });
      if (expanded.has(group.repoId)) {
        group.models.forEach((model, i) => {
          items.push({ type: 'child', model, isLast: i === group.models.length - 1 });
        });
      }
    }
  }
  items.push({ type: 'hf' });
  items.push({ type: 'settings' });
  return items;
}

function variantLabel(model: LocalModel): string {
  return [
    model.metadata?.primaryQuantType || model.fileName.replace(/\.gguf$/i, ''),
    formatSize(model.sizeBytes),
  ].filter(Boolean).join(' · ');
}

function sizeRange(models: LocalModel[]): string {
  const sizes = models.map(m => m.sizeBytes).filter(s => s > 0);
  if (sizes.length === 0) return '';
  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  if (min === max) return formatSize(min);
  return `${formatSize(min)} – ${formatSize(max)}`;
}

function quantList(models: LocalModel[]): string {
  return models
    .map(m => m.metadata?.primaryQuantType || '')
    .filter(Boolean)
    .join(', ');
}

function isTopLevelModelItem(item?: FlatItem): boolean {
  return item?.type === 'single' || item?.type === 'group';
}

function shouldSeparateAfterModelItem(item?: FlatItem): boolean {
  return isTopLevelModelItem(item) || item?.type === 'hf';
}

export function ModelSelect({
  models, loading, hfCachePath, version,
  onSelect, onDelete, onRefresh, onQuit, onSettings,
  initialSelectedIndex, onSelectedIndexChange,
}: ModelSelectProps) {
  const [selectedIndex, _setSelectedIndex] = useState(initialSelectedIndex ?? 0);
  const setSelectedIndex = (update: number | ((prev: number) => number)) => {
    _setSelectedIndex(prev => {
      const next = typeof update === 'function' ? update(prev) : update;
      if (next !== prev) onSelectedIndexChange?.(next);
      return next;
    });
  };
  const [showHfInput, setShowHfInput] = useState(false);
  const [hfInput, setHfInput] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<LocalModel | null>(null);
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const { columns } = useTerminalViewport();

  const groups = useMemo(() => groupModels(models), [models]);
  const flatItems = useMemo(
    () => buildFlatItems(groups, expandedRepos),
    [groups, expandedRepos],
  );

  const itemNumbers = useMemo(() => {
    const nums = new Map<number, number>();
    let n = 0;
    for (let i = 0; i < flatItems.length; i++) {
      const item = flatItems[i];
      if (item.type === 'single' || item.type === 'group' || item.type === 'hf') {
        nums.set(i, ++n);
      }
    }
    return nums;
  }, [flatItems]);

  const totalItems = flatItems.length;
  const listViewport = useScrollableViewport({
    itemCount: totalItems,
    selectedIndex,
    reservedRows: confirmDelete ? 16 : showHfInput ? 14 : 12,
    minRows: 4,
    itemRows: MODEL_ITEM_ROWS,
  });
  const visibleIndexes = Array.from(
    { length: listViewport.end - listViewport.start },
    (_, i) => listViewport.start + i,
  );
  const maxLineWidth = Math.max(24, columns - 12);

  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(0, totalItems - 1)));
  }, [totalItems]);

  const cancelHfInput = () => {
    setShowHfInput(false);
    setHfInput('');
  };

  const toggleExpand = (repoId: string) => {
    setExpandedRepos(prev => {
      const next = new Set(prev);
      if (next.has(repoId)) next.delete(repoId);
      else next.add(repoId);
      return next;
    });
  };

  const getModelAtIndex = (index: number): LocalModel | null => {
    const item = flatItems[index];
    if (item?.type === 'single' || item?.type === 'child') return item.model;
    return null;
  };

  useInput((input, key) => {
    if (showHfInput) {
      if (key.escape) cancelHfInput();
      return;
    }
    if (confirmDelete) return;

    if (input === 'r' || input === 'R' || input === 'к' || input === 'К') {
      onRefresh();
      return;
    }
    if (input === 'q' || input === 'Q' || input === 'й' || input === 'Й') {
      onQuit();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(totalItems - 1, i + 1));
    } else if (input === 'd' || input === 'D' || input === 'в' || input === 'В') {
      const model = getModelAtIndex(selectedIndex);
      if (model) setConfirmDelete(model);
    } else if (key.return) {
      const item = flatItems[selectedIndex];
      if (!item) return;
      if (item.type === 'group') {
        toggleExpand(item.group.repoId);
      } else if (item.type === 'single' || item.type === 'child') {
        const model = item.model;
        onSelect({
          mode: 'local',
          path: model.path,
          label: model.metadata?.name || model.fileName.replace('.gguf', ''),
          metadata: model.metadata,
        });
      } else if (item.type === 'hf') {
        setShowHfInput(true);
      } else if (item.type === 'settings') {
        onSettings();
      }
    } else if (key.rightArrow) {
      const item = flatItems[selectedIndex];
      if (item?.type === 'group' && !expandedRepos.has(item.group.repoId)) {
        toggleExpand(item.group.repoId);
      }
    } else if (key.leftArrow) {
      const item = flatItems[selectedIndex];
      if (item?.type === 'group' && expandedRepos.has(item.group.repoId)) {
        toggleExpand(item.group.repoId);
      } else if (item?.type === 'child') {
        for (let i = selectedIndex - 1; i >= 0; i--) {
          const parent = flatItems[i];
          if (parent?.type === 'group') {
            setSelectedIndex(i);
            toggleExpand(parent.group.repoId);
            break;
          }
        }
      }
    }
  });

  const handleHfSubmit = (value: string) => {
    if (value.trim()) {
      onSelect({
        mode: 'hf',
        repo: value.trim(),
        label: value.trim().split('/').pop() || value.trim(),
      });
    }
    cancelHfInput();
  };

  const renderItem = (index: number) => {
    const item = flatItems[index];
    if (!item) return null;
    const isSelected = index === selectedIndex;
    const num = itemNumbers.get(index);
    const nextItem = flatItems[index + 1];
    const modelGapAfter =
      shouldSeparateAfterModelItem(nextItem) &&
      (item.type === 'single' || item.type === 'group' || (item.type === 'child' && item.isLast));

    if (item.type === 'single') {
      const model = item.model;
      const name = model.metadata?.name || model.repoId;
      const meta = model.metadata ? metadataSummary(model.metadata, model.fileName) : undefined;
      const size = formatSize(model.sizeBytes);

      return (
        <Box key={model.path} flexDirection="column" marginBottom={modelGapAfter ? 1 : 0}>
          <Box>
            <Text color={isSelected ? theme.marker : undefined}>
              {isSelected ? ' › ' : '   '}
            </Text>
            <Box width={4}>
              <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
                {num}.
              </Text>
            </Box>
            <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
              {truncateText(name, maxLineWidth)}
            </Text>
          </Box>
          <Box marginLeft={8}>
            <Text dimColor>{truncateText(model.fileName, maxLineWidth)}</Text>
          </Box>
          <Box marginLeft={8}>
            <Text color={theme.accentMuted}>{size}</Text>
            {meta && <Text dimColor>  {truncateText(meta, Math.max(12, maxLineWidth - size.length - 2))}</Text>}
          </Box>
        </Box>
      );
    }

    if (item.type === 'group') {
      const { group } = item;
      const expanded = expandedRepos.has(group.repoId);
      const quants = quantList(group.models);
      const sizes = sizeRange(group.models);

      if (expanded) {
        return (
          <Box key={`group-${group.repoId}`} flexDirection="column">
            <Box>
              <Text color={isSelected ? theme.marker : undefined}>
                {isSelected ? ' › ' : '   '}
              </Text>
              <Box width={4}>
                <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
                  {num}.
                </Text>
              </Box>
              <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
                {truncateText(group.name, maxLineWidth - 2)}
              </Text>
              <Text color={theme.accentMuted}>{' ▾'}</Text>
            </Box>
            <Box marginLeft={8}>
              <Text dimColor>{truncateText(group.sharedMeta, maxLineWidth)}</Text>
            </Box>
            <Text>{' '}</Text>
          </Box>
        );
      }

      return (
        <Box key={`group-${group.repoId}`} flexDirection="column" marginBottom={modelGapAfter ? 1 : 0}>
          <Box>
            <Text color={isSelected ? theme.marker : undefined}>
              {isSelected ? ' › ' : '   '}
            </Text>
            <Box width={4}>
              <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
                {num}.
              </Text>
            </Box>
            <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
              {truncateText(group.name, maxLineWidth - 2)}
            </Text>
            <Text color={theme.accentMuted}>{' ▸'}</Text>
          </Box>
          <Box marginLeft={8}>
            <Text dimColor>{truncateText(quants || `${group.models.length} files`, maxLineWidth)}</Text>
          </Box>
          <Box marginLeft={8}>
            <Text color={theme.accentMuted}>{sizes}</Text>
            {group.sharedMeta && <Text dimColor>  {truncateText(group.sharedMeta, Math.max(12, maxLineWidth - sizes.length - 2))}</Text>}
          </Box>
        </Box>
      );
    }

    if (item.type === 'child') {
      const model = item.model;
      const label = variantLabel(model);

      return (
        <Box key={model.path} flexDirection="column" marginBottom={modelGapAfter ? 1 : 0}>
          <Box>
            <Text color={isSelected ? theme.marker : undefined}>
              {isSelected ? ' › ' : '   '}
            </Text>
            <Box width={5}>
              <Text>{' '}</Text>
            </Box>
            <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
              {truncateText(label, maxLineWidth - 1)}
            </Text>
          </Box>
        </Box>
      );
    }

    if (item.type === 'hf') {
      return (
        <Box key="hf-input-action" marginBottom={nextItem?.type === 'settings' ? 1 : 0}>
          <Text color={isSelected ? theme.marker : undefined}>
            {isSelected ? ' › ' : '   '}
          </Text>
          <Box width={4}>
            <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
              {num}.
            </Text>
          </Box>
          <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
            Enter Hugging Face repo or URL...
          </Text>
        </Box>
      );
    }

    return (
      <Box key="settings-action">
        <Text color={isSelected ? theme.marker : undefined}>
          {isSelected ? ' › ' : '   '}
        </Text>
        <Box width={4}>
          <Text>{' '}</Text>
        </Box>
        <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
          Settings...
        </Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column">
      <Header title="LOCAL MODELS" version={version} />

      <Box flexDirection="column" marginLeft={2} marginBottom={1}>
        <Box>
          <Text dimColor>Cache: </Text>
          <Text>{truncateText(hfCachePath, Math.max(20, columns - 9))}</Text>
        </Box>
      </Box>

      {loading ? (
        <Box marginLeft={CONTENT_MARGIN_X}>
          <Text color={theme.warning}><Spinner type="dots" /></Text>
          <Text> Scanning for models...</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginLeft={PAGE_MARGIN_X}>
          <Box flexDirection="column" marginLeft={CONTENT_MARGIN_X - PAGE_MARGIN_X}>
            {models.length === 0 && listViewport.start === 0 && (
              <Box>
                <Text dimColor italic>  No local GGUF files found</Text>
              </Box>
            )}

            {listViewport.hasAbove && (
              <Text dimColor>  ... more above</Text>
            )}

            {visibleIndexes.map(renderItem)}

            {listViewport.hasBelow && (
              <Text dimColor>  ... more below</Text>
            )}

            {showHfInput && (
              <Box marginTop={1} marginLeft={8}>
                <Text color={theme.accent}>{'> '}</Text>
                <TextInput
                  value={hfInput}
                  onChange={setHfInput}
                  onSubmit={handleHfSubmit}
                  placeholder="user/repo or https://huggingface.co/..."
                />
              </Box>
            )}
          </Box>
        </Box>
      )}

      {!confirmDelete && (
        <Box marginLeft={CONTENT_MARGIN_X}>
          <KeyHint hints={showHfInput ? [
            { key: 'enter', label: 'submit' },
            { key: 'esc', label: 'cancel' },
          ] : [
            { key: '↑↓', label: 'navigate' },
            { key: '⏎', label: 'select' },
            { key: '←→', label: 'expand' },
            { key: 'r', label: loading ? 'refreshing' : 'refresh' },
            ...(getModelAtIndex(selectedIndex) ? [{ key: 'd', label: 'delete' }] : []),
            { key: 'q', label: 'quit' },
          ]} />
        </Box>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete model from cache?"
          lines={buildDeleteLines(confirmDelete, models)}
          onConfirm={() => {
            onDelete(confirmDelete);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </Box>
  );
}

function buildDeleteLines(model: LocalModel, allModels: LocalModel[]): string[] {
  const lines: string[] = [
    `${model.fileName}  (${formatSize(model.sizeBytes)})`,
  ];
  const siblings = getSiblingModels(model, allModels);
  if (siblings.length > 0) {
    lines.push('');
    lines.push('Other variants in this repo (will NOT be deleted):');
    for (const s of siblings) {
      lines.push(`  ${s.fileName}  (${formatSize(s.sizeBytes)})`);
    }
  }
  return lines;
}

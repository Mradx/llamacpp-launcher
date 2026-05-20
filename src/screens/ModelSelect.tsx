import React, { useMemo, useState, useEffect } from 'react';
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
}

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

function extractQuantLabel(fileName: string): string {
  const base = fileName.replace(/\.gguf$/i, '').replace(/-\d{5}-of-\d{5}$/, '');
  const match = base.match(/[-_]((?:UD[-_])?(?:I?Q\d[-_\w]*|[BF]F?\d+\w*|Q\d[-_\w]*))$/i);
  return match?.[1]?.replace(/_/g, '-') || 'GGUF';
}

function groupLabel(model: LocalModel): string {
  return model.metadata?.baseName || model.metadata?.name || model.repoId;
}

function countByRepo(models: LocalModel[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const model of models) {
    counts.set(model.repoId, (counts.get(model.repoId) || 0) + 1);
  }
  return counts;
}

export function ModelSelect({ models, loading, hfCachePath, version, onSelect, onDelete, onRefresh, onQuit, onSettings }: ModelSelectProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showHfInput, setShowHfInput] = useState(false);
  const [hfInput, setHfInput] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<LocalModel | null>(null);
  const { columns } = useTerminalViewport();

  const hfIndex = models.length;
  const settingsIndex = models.length + 1;
  const totalItems = models.length + 2;
  const repoCounts = useMemo(() => countByRepo(models), [models]);
  const listViewport = useScrollableViewport({
    itemCount: totalItems,
    selectedIndex,
    reservedRows: confirmDelete ? 16 : showHfInput ? 14 : 12,
    minRows: 4,
    itemRows: 3,
  });
  const visibleIndexes = Array.from(
    { length: listViewport.end - listViewport.start },
    (_, i) => listViewport.start + i,
  );
  const maxLineWidth = Math.max(24, columns - 12);
  const variantLineWidth = Math.max(18, columns - 18);

  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(0, totalItems - 1)));
  }, [totalItems]);

  const cancelHfInput = () => {
    setShowHfInput(false);
    setHfInput('');
  };

  useInput((input, key) => {
    if (showHfInput) {
      if (key.escape) {
        cancelHfInput();
      }
      return;
    }

    if (confirmDelete) return;

    if (input === 'r' || input === 'R' || input === '\u043a' || input === '\u041a') {
      onRefresh();
      return;
    }

    if (input === 'q' || input === 'Q' || input === '\u0439' || input === '\u0419') {
      onQuit();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(totalItems - 1, i + 1));
    } else if (input === 'd' || input === 'D' || input === '\u0432' || input === '\u0412') {
      if (selectedIndex < models.length) {
        setConfirmDelete(models[selectedIndex]);
      }
    } else if (key.return) {
      if (selectedIndex < models.length) {
        const model = models[selectedIndex];
        onSelect({
          mode: 'local',
          path: model.path,
          label: model.metadata?.name || model.fileName.replace('.gguf', ''),
          metadata: model.metadata,
        });
      } else if (selectedIndex === hfIndex) {
        setShowHfInput(true);
      } else if (selectedIndex === settingsIndex) {
        onSettings();
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

  const renderItem = (index: number, showGroupHeader: boolean) => {
    if (index < models.length) {
      const model = models[index];
      const isSelected = index === selectedIndex;
      const meta = model.metadata ? metadataSummary(model.metadata, model.fileName) : undefined;
      const size = formatSize(model.sizeBytes);
      const quant = model.metadata?.primaryQuantType || extractQuantLabel(model.fileName);
      const variants = repoCounts.get(model.repoId) || 1;

      return (
        <Box key={model.path} flexDirection="column">
          {showGroupHeader && (
            <Box marginTop={index === listViewport.start ? 0 : 1}>
              <Text color={theme.accentDim}>▾ </Text>
              <Text color={theme.logoText} bold>{truncateText(groupLabel(model), maxLineWidth)}</Text>
              <Text dimColor>  {variants} variant{variants === 1 ? '' : 's'}</Text>
            </Box>
          )}
          <Box flexDirection="column" marginLeft={2}>
            <Box>
              <Text color={isSelected ? theme.marker : undefined}>
                {isSelected ? ' › ' : '   '}
              </Text>
              <Box width={4}>
                <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
                  {index + 1}.
                </Text>
              </Box>
              <Box width={14}>
                <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
                  {truncateText(quant, 12)}
                </Text>
              </Box>
              <Text dimColor>{truncateText(model.fileName, Math.max(12, variantLineWidth - 18))}</Text>
            </Box>
            <Box marginLeft={7}>
              <Text color={theme.accentMuted}>{size}</Text>
              {meta && <Text dimColor>  {truncateText(meta, Math.max(12, variantLineWidth - size.length - 9))}</Text>}
            </Box>
          </Box>
        </Box>
      );
    }

    if (index === hfIndex) {
      const isSelected = selectedIndex === hfIndex;
      return (
        <Box key="hf-input-action" marginTop={models.length > 0 ? 1 : 0}>
          <Text color={isSelected ? theme.marker : undefined}>
            {isSelected ? ' › ' : '   '}
          </Text>
          <Box width={4}>
            <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
              {models.length + 1}.
            </Text>
          </Box>
          <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
            Enter Hugging Face repo or URL...
          </Text>
        </Box>
      );
    }

    const isSelected = selectedIndex === settingsIndex;
    return (
      <Box key="settings-action">
        <Text color={isSelected ? theme.marker : undefined}>
          {isSelected ? ' › ' : '   '}
        </Text>
        <Box width={4}>
          <Text> </Text>
        </Box>
        <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
          Settings...
        </Text>
      </Box>
    );
  };

  const renderedItems: React.ReactNode[] = [];
  let lastRepoId: string | null = null;
  for (const index of visibleIndexes) {
    if (index < models.length) {
      const repoId = models[index].repoId;
      renderedItems.push(renderItem(index, repoId !== lastRepoId));
      lastRepoId = repoId;
    } else {
      renderedItems.push(renderItem(index, false));
      lastRepoId = null;
    }
  }

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

            {renderedItems}

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
            { key: 'r', label: loading ? 'refreshing' : 'refresh' },
            ...(selectedIndex < models.length ? [{ key: 'd', label: 'delete' }] : []),
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

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { CONTENT_MARGIN_X, PAGE_MARGIN_X } from '../layout.js';
import { formatSize } from '../utils/format.js';
import { getSiblingModels } from '../services/models.js';
import type { LocalModel, ModelMetadata, ModelSelection } from '../types.js';
import { theme } from '../theme.js';

interface ModelSelectProps {
  models: LocalModel[];
  loading: boolean;
  hfCachePath: string;
  onSelect: (model: ModelSelection) => void;
  onDelete: (model: LocalModel) => void;
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

export function ModelSelect({ models, loading, hfCachePath, onSelect, onDelete, onQuit, onSettings }: ModelSelectProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showHfInput, setShowHfInput] = useState(false);
  const [hfInput, setHfInput] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<LocalModel | null>(null);

  const hfIndex = models.length;
  const settingsIndex = models.length + 1;
  const totalItems = models.length + 2;

  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(0, models.length)));
  }, [models.length]);

  useInput((input, key) => {
    if (showHfInput || confirmDelete) return;

    if (input === 'q' || input === 'Q' || input === 'й' || input === 'Й') {
      onQuit();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(totalItems - 1, i + 1));
    } else if (input === 'd' || input === 'D' || input === 'в' || input === 'В') {
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
    setShowHfInput(false);
    setHfInput('');
  };

  return (
    <Box flexDirection="column">
      <Header title="LOCAL MODELS" />

      <Box flexDirection="column" marginLeft={2} marginBottom={1}>
        <Box>
          <Text dimColor>Cache: </Text>
          <Text>{hfCachePath}</Text>
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
            {models.length === 0 && (
              <Box marginY={1}>
                <Text dimColor italic>  No local GGUF files found</Text>
              </Box>
            )}

            {models.map((model, i) => (
              <Box key={model.path} flexDirection="column" marginBottom={1}>
                <Box>
                  <Text color={i === selectedIndex ? theme.marker : undefined}>
                    {i === selectedIndex ? ' › ' : '   '}
                  </Text>
                  <Box width={4}>
                    <Text color={i === selectedIndex ? 'white' : theme.textMuted} bold={i === selectedIndex}>
                      {i + 1}.
                    </Text>
                  </Box>
                  <Text color={i === selectedIndex ? 'white' : theme.textMuted} bold={i === selectedIndex}>
                    {model.metadata?.name || model.repoId}
                  </Text>
                </Box>
                <Box marginLeft={8}>
                  <Text dimColor>{model.fileName}</Text>
                </Box>
                <Box marginLeft={8}>
                  <Text color={theme.accentMuted}>{formatSize(model.sizeBytes)}</Text>
                  {model.metadata && <Text dimColor>  {metadataSummary(model.metadata, model.fileName)}</Text>}
                </Box>
              </Box>
            ))}

            <Box>
              <Text color={selectedIndex === hfIndex ? theme.marker : undefined}>
                {selectedIndex === hfIndex ? ' › ' : '   '}
              </Text>
              <Box width={4}>
                <Text color={selectedIndex === hfIndex ? 'white' : theme.textMuted} bold={selectedIndex === hfIndex}>
                  {models.length + 1}.
                </Text>
              </Box>
              <Text color={selectedIndex === hfIndex ? 'white' : theme.textMuted} bold={selectedIndex === hfIndex}>
                Enter Hugging Face repo or URL...
              </Text>
            </Box>

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

            <Box marginTop={1}>
              <Text color={selectedIndex === settingsIndex ? theme.marker : undefined}>
                {selectedIndex === settingsIndex ? ' › ' : '   '}
              </Text>
              <Box width={4}>
                <Text> </Text>
              </Box>
              <Text color={selectedIndex === settingsIndex ? 'white' : theme.textMuted} bold={selectedIndex === settingsIndex}>
                Settings...
              </Text>
            </Box>

            <Text> </Text>
          </Box>
        </Box>
      )}

      {!confirmDelete && (
        <Box marginLeft={CONTENT_MARGIN_X}>
          <KeyHint hints={[
            { key: '↑↓', label: 'navigate' },
            { key: '⏎', label: 'select' },
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

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { formatSize } from '../utils/format.js';
import { getSiblingModels } from '../services/models.js';
import type { LocalModel, ModelSelection } from '../types.js';

interface ModelSelectProps {
  models: LocalModel[];
  loading: boolean;
  hfCachePath: string;
  onSelect: (model: ModelSelection) => void;
  onDelete: (model: LocalModel) => void;
  onQuit: () => void;
}

export function ModelSelect({ models, loading, hfCachePath, onSelect, onDelete, onQuit }: ModelSelectProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showHfInput, setShowHfInput] = useState(false);
  const [hfInput, setHfInput] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<LocalModel | null>(null);

  const totalItems = models.length + 1; // models + HF option

  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(0, models.length)));
  }, [models.length]);

  useInput((input, key) => {
    if (showHfInput || confirmDelete) return;

    if (input === 'q') {
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
          label: model.fileName.replace('.gguf', ''),
        });
      } else {
        setShowHfInput(true);
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
      <Header title="LLAMA.CPP LAUNCHER" subtitle={`Cache: ${hfCachePath}`} />

      {loading ? (
        <Box marginLeft={2}>
          <Text color="#eab308"><Spinner type="dots" /></Text>
          <Text> Scanning for models...</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginLeft={2}>
          <Box marginBottom={1}>
            <Text bold color="#8b5cf6">LOCAL MODELS</Text>
          </Box>
          <Box marginBottom={0}>
            <Text dimColor>{'─'.repeat(50)}</Text>
          </Box>

          {models.length === 0 && (
            <Box marginY={1}>
              <Text dimColor italic>  No local GGUF files found</Text>
            </Box>
          )}

          {models.map((model, i) => (
            <Box key={model.path} flexDirection="column">
              <Box>
                <Text color={i === selectedIndex ? '#d946ef' : undefined}>
                  {i === selectedIndex ? ' › ' : '   '}
                </Text>
                <Text color={i === selectedIndex ? 'white' : '#a1a1aa'} bold={i === selectedIndex}>
                  {i + 1}. {model.repoId}
                </Text>
              </Box>
              <Box marginLeft={5}>
                <Text dimColor>{model.fileName}</Text>
                <Text dimColor color="#8b5cf6">  {formatSize(model.sizeBytes)}</Text>
              </Box>
            </Box>
          ))}

          <Box marginTop={models.length > 0 ? 1 : 0}>
            <Text color={selectedIndex === models.length ? '#d946ef' : undefined}>
              {selectedIndex === models.length ? ' › ' : '   '}
            </Text>
            <Text color={selectedIndex === models.length ? 'white' : '#a1a1aa'} bold={selectedIndex === models.length}>
              {models.length + 1}. Enter Hugging Face repo or URL...
            </Text>
          </Box>

          {showHfInput && (
            <Box marginTop={1} marginLeft={5}>
              <Text color="#8b5cf6">{'> '}</Text>
              <TextInput
                value={hfInput}
                onChange={setHfInput}
                onSubmit={handleHfSubmit}
                placeholder="user/repo or https://huggingface.co/..."
              />
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>{'─'.repeat(50)}</Text>
          </Box>
        </Box>
      )}

      {!confirmDelete && (
        <Box marginLeft={2}>
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

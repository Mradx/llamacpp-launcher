import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { validateLlamaCppDir, saveUserConfig } from '../config.js';
import { useInstaller } from '../hooks/useInstaller.js';
import { getDataRoot } from '../storage.js';
import type { StoredConfig } from '../types.js';
import { theme } from '../theme.js';

interface SettingsScreenProps {
  currentConfig: StoredConfig;
  onDone: (saved: boolean, updated?: boolean) => void;
}

const HOST_OPTIONS = [
  { value: '127.0.0.1', label: 'Local only (127.0.0.1)' },
  { value: '0.0.0.0', label: 'LAN accessible (0.0.0.0)' },
];

type FieldKey = 'llamaCppDir' | 'hfCachePath' | 'host' | 'port' | 'parallelSlots' | 'draftTokens';

interface FieldDef {
  key: FieldKey;
  label: string;
  desc: string;
  type: 'text' | 'toggle' | 'numeric';
  min?: number;
  max?: number;
}

const FIELDS: FieldDef[] = [
  { key: 'llamaCppDir', label: 'llama.cpp folder', desc: 'Path to llama.cpp source directory', type: 'text' },
  { key: 'hfCachePath', label: 'HF Cache path', desc: 'Hugging Face model cache location', type: 'text' },
  { key: 'host', label: 'Host', desc: 'Server access mode', type: 'toggle' },
  { key: 'port', label: 'Port', desc: 'Server port (1-65535)', type: 'numeric', min: 1, max: 65535 },
  { key: 'parallelSlots', label: 'Parallel slots', desc: 'Concurrent inference slots', type: 'numeric', min: 1, max: 8 },
  { key: 'draftTokens', label: 'Draft tokens', desc: 'Speculative decoding draft tokens', type: 'numeric', min: 0, max: 16 },
];

const STATE_FILES = ['config.json', 'params-history.json', 'template-overrides.json'];

const UPDATE_INDEX = FIELDS.length;
const REBUILD_INDEX = FIELDS.length + 1;
const SAVE_INDEX = FIELDS.length + 2;
const DISCARD_INDEX = FIELDS.length + 3;
const TOTAL_ITEMS = FIELDS.length + 4; // fields + update + rebuild + save + discard

type InstallAction = 'update' | 'rebuild';

export function SettingsScreen({ currentConfig, onDone }: SettingsScreenProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [pathStatus, setPathStatus] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [activeAction, setActiveAction] = useState<InstallAction | null>(null);
  const {
    startUpdate,
    startRebuild,
    progress: installProgress,
    installing: installRunning,
    error: installError,
    completed: installCompleted,
    sourceChanged,
  } = useInstaller();

  const [values, setValues] = useState<Record<FieldKey, string | number>>({
    llamaCppDir: currentConfig.llamaCppDir,
    hfCachePath: currentConfig.hfCachePath,
    host: currentConfig.host,
    port: currentConfig.port,
    parallelSlots: currentConfig.parallelSlots,
    draftTokens: currentConfig.draftTokens,
  });

  const hostIdx = HOST_OPTIONS.findIndex(o => o.value === values.host);
  const dataRoot = getDataRoot();

  const clearFieldError = (key: FieldKey) => {
    setFieldErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSave = () => {
    const validation = validateLlamaCppDir(String(values.llamaCppDir));
    if (!validation.ok) {
      setPathStatus(validation.error!);
      setSelectedIndex(0);
      return;
    }
    const config: StoredConfig = {
      ...currentConfig,
      llamaCppDir: String(values.llamaCppDir),
      hfCachePath: String(values.hfCachePath),
      host: String(values.host),
      port: Number(values.port),
      parallelSlots: Number(values.parallelSlots),
      draftTokens: Number(values.draftTokens),
    };
    saveUserConfig(config);
    onDone(true, sourceChanged);
  };

  const submitTextEdit = (value: string) => {
    const field = FIELDS[selectedIndex];
    const trimmed = value.trim();

    if (field.type === 'numeric') {
      const parsed = Number(trimmed);
      if (!/^\d+$/.test(trimmed) || !Number.isInteger(parsed) || parsed < field.min! || parsed > field.max!) {
        setFieldErrors(prev => ({
          ...prev,
          [field.key]: `${field.label} must be between ${field.min} and ${field.max}`,
        }));
        return;
      }

      clearFieldError(field.key);
      setValues(prev => ({ ...prev, [field.key]: parsed }));
      setEditing(false);
      return;
    }

    if (field.key === 'llamaCppDir') {
      const result = validateLlamaCppDir(trimmed);
      setPathStatus(result.ok ? '' : result.error!);
    }

    clearFieldError(field.key);
    setValues(prev => ({ ...prev, [field.key]: trimmed }));
    setEditing(false);
  };

  useInput((input, key) => {
    if (editing) {
      if (key.escape) {
        setEditing(false);
      }
      return;
    }

    if (key.escape) {
      onDone(false, sourceChanged);
      return;
    }

    if (installRunning) return;

    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(TOTAL_ITEMS - 1, i + 1));
    } else if (key.return) {
      if (selectedIndex < FIELDS.length) {
        const field = FIELDS[selectedIndex];
        if (field.type === 'text' || field.type === 'numeric') {
          setEditValue(String(values[field.key]));
          setEditing(true);
        }
      } else if (selectedIndex === UPDATE_INDEX) {
        const dir = String(values.llamaCppDir);
        if (dir) {
          setActiveAction('update');
          startUpdate(dir);
        }
      } else if (selectedIndex === REBUILD_INDEX) {
        const dir = String(values.llamaCppDir);
        if (dir) {
          setActiveAction('rebuild');
          startRebuild(dir);
        }
      } else if (selectedIndex === SAVE_INDEX) {
        handleSave();
      } else {
        onDone(false, sourceChanged);
      }
    } else if (key.leftArrow || key.rightArrow) {
      if (selectedIndex < FIELDS.length) {
        const field = FIELDS[selectedIndex];
        const dir = key.rightArrow ? 1 : -1;
        if (field.type === 'toggle') {
          const newIdx = (hostIdx + dir + HOST_OPTIONS.length) % HOST_OPTIONS.length;
          setValues(prev => ({ ...prev, host: HOST_OPTIONS[newIdx].value }));
        } else if (field.type === 'numeric') {
          const current = Number(values[field.key]);
          const next = Math.max(field.min!, Math.min(field.max!, current + dir));
          clearFieldError(field.key);
          setValues(prev => ({ ...prev, [field.key]: next }));
        }
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Header title="SETTINGS" />

      <Box flexDirection="column" marginLeft={2}>
        {FIELDS.map((field, i) => {
          const isSelected = i === selectedIndex;
          const value = values[field.key];
          const error = field.key === 'llamaCppDir' ? pathStatus : fieldErrors[field.key];

          let displayValue: string;
          if (field.type === 'toggle') {
            const opt = HOST_OPTIONS.find(o => o.value === value);
            displayValue = opt?.label || String(value);
          } else {
            displayValue = String(value) || '(not set)';
          }

          const isEditing = editing && isSelected;

          return (
            <Box key={field.key} flexDirection="column" marginBottom={0}>
              <Box>
                <Text color={isSelected ? theme.marker : undefined}>
                  {isSelected ? ' › ' : '   '}
                </Text>
                <Box width={18}>
                  <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
                    {field.label}
                  </Text>
                </Box>
                {isEditing ? (
                  <Box>
                    <TextInput
                      value={editValue}
                      onChange={setEditValue}
                      onSubmit={submitTextEdit}
                    />
                  </Box>
                ) : (
                  <Box>
                    {field.type !== 'text' && (
                      <Text color={isSelected ? theme.accent : theme.neutral}> {'◂'} </Text>
                    )}
                    <Text color={isSelected ? 'white' : undefined}>
                      {!value && field.type === 'text' ? '' : displayValue}
                    </Text>
                    {!value && field.type === 'text' && (
                      <Text dimColor>(not set)</Text>
                    )}
                    {field.type !== 'text' && (
                      <Text color={isSelected ? theme.accent : theme.neutral}> {'▸'}</Text>
                    )}
                  </Box>
                )}
              </Box>
              <Box marginLeft={3}>
                <Text dimColor>{'  '.repeat(9)}{field.desc}</Text>
              </Box>
              {error && (
                <Box marginLeft={3} flexDirection="column">
                  {error.split('\n').map((line, j) => (
                    <Text key={j} color={theme.danger}>{'  '.repeat(9)}{line}</Text>
                  ))}
                </Box>
              )}
            </Box>
          );
        })}

        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color={selectedIndex === UPDATE_INDEX ? theme.marker : undefined}>
              {selectedIndex === UPDATE_INDEX ? ' › ' : '   '}
            </Text>
            <Text color={selectedIndex === UPDATE_INDEX ? theme.accent : theme.textMuted} bold={selectedIndex === UPDATE_INDEX}>
              Update llama.cpp (git pull)
            </Text>
            {activeAction === 'update' && installRunning && (
              <Box marginLeft={1}>
                <Text color={theme.accent}><Spinner type="dots" /></Text>
                <Text dimColor> {installProgress?.message || 'Updating...'}</Text>
              </Box>
            )}
          </Box>
          {activeAction === 'update' && installCompleted && (
            <Box marginLeft={3}>
              <Text color={theme.success}> {installProgress?.message || 'Update complete!'}</Text>
            </Box>
          )}
          {activeAction === 'update' && installError && (
            <Box marginLeft={3} flexDirection="column">
              {installError.split('\n').slice(0, 5).map((line, i) => (
                <Text key={i} color={theme.danger}> {line}</Text>
              ))}
            </Box>
          )}
        </Box>

        <Box marginTop={1}>
          <Text color={selectedIndex === REBUILD_INDEX ? theme.marker : undefined}>
            {selectedIndex === REBUILD_INDEX ? ' › ' : '   '}
          </Text>
          <Text color={selectedIndex === REBUILD_INDEX ? theme.accent : theme.textMuted} bold={selectedIndex === REBUILD_INDEX}>
            Rebuild llama.cpp
          </Text>
          {activeAction === 'rebuild' && installRunning && (
            <Box marginLeft={1}>
              <Text color={theme.accent}><Spinner type="dots" /></Text>
              <Text dimColor> {installProgress?.message || 'Rebuilding...'}</Text>
            </Box>
          )}
        </Box>
        {activeAction === 'rebuild' && installCompleted && (
          <Box marginLeft={3}>
            <Text color={theme.success}> {installProgress?.message || 'Rebuild complete!'}</Text>
          </Box>
        )}
        {activeAction === 'rebuild' && installError && (
          <Box marginLeft={3} flexDirection="column">
            {installError.split('\n').slice(0, 5).map((line, i) => (
              <Text key={i} color={theme.danger}> {line}</Text>
            ))}
          </Box>
        )}

        <Box marginTop={1}>
          <Text color={selectedIndex === SAVE_INDEX ? theme.marker : undefined}>
            {selectedIndex === SAVE_INDEX ? ' › ' : '   '}
          </Text>
          <Text color={selectedIndex === SAVE_INDEX ? theme.success : theme.textMuted} bold={selectedIndex === SAVE_INDEX}>
            Save and return
          </Text>
        </Box>

        <Box>
          <Text color={selectedIndex === DISCARD_INDEX ? theme.marker : undefined}>
            {selectedIndex === DISCARD_INDEX ? ' › ' : '   '}
          </Text>
          <Text color={selectedIndex === DISCARD_INDEX ? theme.danger : theme.textMuted} bold={selectedIndex === DISCARD_INDEX}>
            Discard changes
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color={theme.textMuted} bold>State files</Text>
          <Text dimColor>   Folder: {dataRoot}</Text>
          <Text dimColor>   Files: {STATE_FILES.join(', ')}</Text>
          <Text dimColor>   Override: LLAMACPP_LAUNCHER_HOME</Text>
        </Box>
      </Box>

      <Box marginLeft={2}>
        <KeyHint hints={
          editing
            ? [{ key: '⏎', label: 'confirm' }, { key: 'esc', label: 'cancel' }]
            : [
              { key: '↑↓', label: 'navigate' },
              { key: '⏎', label: 'edit/select' },
              { key: '←→', label: 'adjust' },
              { key: 'esc', label: 'back' },
            ]
        } />
      </Box>
    </Box>
  );
}

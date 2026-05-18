import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { validateLlamaCppDir, saveUserConfig } from '../config.js';
import type { StoredConfig } from '../types.js';
import { theme } from '../theme.js';

interface SettingsScreenProps {
  currentConfig: StoredConfig;
  onDone: (saved: boolean) => void;
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
  { key: 'port', label: 'Port', desc: 'Server port (1024-65535)', type: 'numeric', min: 1024, max: 65535 },
  { key: 'parallelSlots', label: 'Parallel slots', desc: 'Concurrent inference slots', type: 'numeric', min: 1, max: 8 },
  { key: 'draftTokens', label: 'Draft tokens', desc: 'Speculative decoding draft tokens', type: 'numeric', min: 0, max: 16 },
];

const TOTAL_ITEMS = FIELDS.length + 2; // fields + save + discard

export function SettingsScreen({ currentConfig, onDone }: SettingsScreenProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [pathStatus, setPathStatus] = useState('');

  const [values, setValues] = useState<Record<FieldKey, string | number>>({
    llamaCppDir: currentConfig.llamaCppDir,
    hfCachePath: currentConfig.hfCachePath,
    host: currentConfig.host,
    port: currentConfig.port,
    parallelSlots: currentConfig.parallelSlots,
    draftTokens: currentConfig.draftTokens,
  });

  const hostIdx = HOST_OPTIONS.findIndex(o => o.value === values.host);

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
    onDone(true);
  };

  const submitTextEdit = (value: string) => {
    const field = FIELDS[selectedIndex];
    const trimmed = value.trim();
    setValues(prev => ({ ...prev, [field.key]: trimmed }));
    setEditing(false);

    if (field.key === 'llamaCppDir') {
      const result = validateLlamaCppDir(trimmed);
      setPathStatus(result.ok ? '' : result.error!);
    }
  };

  useInput((input, key) => {
    if (editing) {
      if (key.escape) {
        setEditing(false);
      }
      return;
    }

    if (key.escape) {
      onDone(false);
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(TOTAL_ITEMS - 1, i + 1));
    } else if (key.return) {
      if (selectedIndex < FIELDS.length) {
        const field = FIELDS[selectedIndex];
        if (field.type === 'text') {
          setEditValue(String(values[field.key]));
          setEditing(true);
        }
      } else if (selectedIndex === FIELDS.length) {
        handleSave();
      } else {
        onDone(false);
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
              {field.key === 'llamaCppDir' && pathStatus && (
                <Box marginLeft={3} flexDirection="column">
                  {pathStatus.split('\n').map((line, j) => (
                    <Text key={j} color={theme.danger}>{'  '.repeat(9)}{line}</Text>
                  ))}
                </Box>
              )}
            </Box>
          );
        })}

        <Box marginTop={1}>
          <Text color={selectedIndex === FIELDS.length ? theme.marker : undefined}>
            {selectedIndex === FIELDS.length ? ' › ' : '   '}
          </Text>
          <Text color={selectedIndex === FIELDS.length ? theme.success : theme.textMuted} bold={selectedIndex === FIELDS.length}>
            Save and return
          </Text>
        </Box>

        <Box>
          <Text color={selectedIndex === FIELDS.length + 1 ? theme.marker : undefined}>
            {selectedIndex === FIELDS.length + 1 ? ' › ' : '   '}
          </Text>
          <Text color={selectedIndex === FIELDS.length + 1 ? theme.danger : theme.textMuted} bold={selectedIndex === FIELDS.length + 1}>
            Discard changes
          </Text>
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

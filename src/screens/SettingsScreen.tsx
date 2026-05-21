import React, { useEffect, useState } from 'react';
import { existsSync, statSync } from 'node:fs';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { validateLlamaCppDir, saveUserConfig } from '../config.js';
import { useInstaller } from '../hooks/useInstaller.js';
import { getDataPath, getDataRoot } from '../storage.js';
import { useTerminalViewport } from '../hooks/useTerminalViewport.js';
import { clampLines, truncateText } from '../utils/terminal.js';
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

const STATE_FILES = ['config.json', 'params-history.json', 'template-overrides.json', 'model-preferences.json'];

const UPDATE_INDEX = FIELDS.length;
const SAVE_INDEX = FIELDS.length + 1;
const DISCARD_INDEX = FIELDS.length + 2;
const TOTAL_ITEMS = FIELDS.length + 3; // fields + update + save + discard
const TABS_INDEX = -1;

// Render both tabs at the same height. Ink decides between an in-place
// differential redraw (log-update) and a full terminal clear purely from
// whether the frame height reaches the terminal height (see ink's onRender:
// `outputHeight >= stdout.rows`). If one tab overflows the terminal while the
// other fits, ink flips between those two modes and log-update's cached line
// count goes stale, which leaves the screen frozen on the previous tab. A
// shared min-height keeps the frame height constant across both tabs and also
// absorbs the extra status line, so finishing an update never changes the
// height either.
const TAB_BODY_HEIGHT = 21;

type SettingsTab = 'config' | 'info';
type StateFileInfo = ReturnType<typeof getStateFileInfo>;

const TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: 'config', label: 'Config' },
  { key: 'info', label: 'Info' },
];

function formatStateFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatStateFileTime(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SettingsTabs({
  activeTab,
  focused,
}: {
  activeTab: SettingsTab;
  focused: boolean;
}) {
  return (
    <Box marginLeft={2} marginBottom={1}>
      {TABS.map(tab => {
        const active = tab.key === activeTab;
        return (
          <Box key={tab.key} marginRight={1}>
            <Text
              color={active ? '#000000' : 'white'}
              backgroundColor={active ? focused ? theme.accent : 'white' : undefined}
              bold={active}
            >
              {` ${tab.label} `}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function getStateFileInfo(fileName: string) {
  const path = getDataPath(fileName);
  if (!existsSync(path)) {
    return { fileName, path, status: 'missing' as const };
  }

  try {
    const stat = statSync(path);
    return {
      fileName,
      path,
      status: 'present' as const,
      size: formatStateFileSize(stat.size),
      modified: formatStateFileTime(stat.mtime),
    };
  } catch {
    return { fileName, path, status: 'unreadable' as const };
  }
}

export function SettingsScreen({ currentConfig, onDone }: SettingsScreenProps) {
  const { rows, columns } = useTerminalViewport();
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(TABS_INDEX);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [pathStatus, setPathStatus] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [stateFiles, setStateFiles] = useState<StateFileInfo[]>([]);
  const {
    startUpdate,
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

  const activeTab = TABS[activeTabIndex].key;
  const hostIdx = HOST_OPTIONS.findIndex(o => o.value === values.host);
  const dataRoot = getDataRoot();
  const bodyHeight = Math.max(8, rows - 8);
  const maxLineWidth = Math.max(24, columns - 8);

  useEffect(() => {
    if (activeTab === 'info') {
      setStateFiles(STATE_FILES.map(getStateFileInfo));
    }
  }, [activeTab]);

  const switchTab = () => {
    setEditing(false);
    setActiveTabIndex(index => (index + 1) % TABS.length);
    setSelectedIndex(TABS_INDEX);
  };

  const moveActiveTab = (dir: -1 | 1) => {
    setActiveTabIndex(index => (index + dir + TABS.length) % TABS.length);
    setSelectedIndex(TABS_INDEX);
  };

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

    if (key.tab || input === '\t') {
      switchTab();
      return;
    }

    if (key.escape) {
      onDone(false, sourceChanged);
      return;
    }

    if (selectedIndex === TABS_INDEX) {
      if (key.leftArrow) {
        moveActiveTab(-1);
      } else if (key.rightArrow) {
        moveActiveTab(1);
      } else if (key.downArrow && activeTab === 'config') {
        setSelectedIndex(0);
      }
      return;
    }

    if (activeTab === 'info') {
      if (key.upArrow) {
        setSelectedIndex(TABS_INDEX);
      }
      return;
    }

    if (installRunning) return;

    if (key.upArrow) {
      setSelectedIndex(i => i <= 0 ? TABS_INDEX : i - 1);
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
          startUpdate(dir);
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
      <SettingsTabs
        activeTab={activeTab}
        focused={selectedIndex === TABS_INDEX}
      />

      {activeTab === 'config' ? (
        <Box flexDirection="column" marginLeft={2} minHeight={Math.min(TAB_BODY_HEIGHT, bodyHeight)} height={bodyHeight}>
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
                        {!value && field.type === 'text' ? '' : truncateText(displayValue, maxLineWidth - 24)}
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
                    {clampLines(error, 2, maxLineWidth - 24).map((line, j) => (
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
                Update llama.cpp (git pull + rebuild)
              </Text>
              {installRunning && (
                <Box marginLeft={1}>
                  <Text color={theme.accent}><Spinner type="dots" /></Text>
                  <Text dimColor> {truncateText(installProgress?.message || 'Updating...', maxLineWidth - 28)}</Text>
                </Box>
              )}
            </Box>
            {installCompleted && (
              <Box marginLeft={3}>
                <Text color={theme.success}> {truncateText(installProgress?.message || 'Update complete!', maxLineWidth - 6)}</Text>
              </Box>
            )}
            {installError && (
              <Box marginLeft={3} flexDirection="column">
                {clampLines(installError, 4, maxLineWidth - 6).map((line, i) => (
                  <Text key={i} color={theme.danger}> {line}</Text>
                ))}
              </Box>
            )}
          </Box>
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
        </Box>
      ) : (
        <Box flexDirection="column" marginLeft={2} minHeight={Math.min(TAB_BODY_HEIGHT, bodyHeight)} height={bodyHeight}>
          <Box flexDirection="column" marginBottom={1}>
            <Text color={theme.textMuted} bold>State root</Text>
            <Text>{truncateText(dataRoot, maxLineWidth)}</Text>
          </Box>

          <Box flexDirection="column" marginBottom={1}>
            <Text color={theme.textMuted} bold>Environment override</Text>
            <Text dimColor>LLAMACPP_LAUNCHER_HOME</Text>
          </Box>

          <Box flexDirection="column">
            <Text color={theme.textMuted} bold>State files</Text>
            {stateFiles.map(file => (
              <Box key={file.fileName} flexDirection="column" marginTop={1}>
                <Box>
                  <Box width={26}>
                    <Text color={file.status === 'present' ? 'white' : theme.warning}>{file.fileName}</Text>
                  </Box>
                  <Text color={file.status === 'present' ? theme.success : theme.warning}>
                    {file.status}
                  </Text>
                  {file.status === 'present' && (
                    <Text dimColor>  {file.size}  {file.modified}</Text>
                  )}
                </Box>
                <Box marginLeft={2}>
                  <Text dimColor>{truncateText(file.path, maxLineWidth - 2)}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <Box marginLeft={2}>
        <KeyHint hints={
          editing
            ? [{ key: '⏎', label: 'confirm' }, { key: 'esc', label: 'cancel' }]
            : activeTab === 'config'
              ? [
              { key: '↑↓', label: 'navigate' },
              { key: '⏎', label: 'edit/select' },
              { key: '←→', label: selectedIndex === TABS_INDEX ? 'switch tab' : 'adjust' },
              { key: 'tab', label: 'info' },
              { key: 'esc', label: 'back' },
            ]
              : [
              { key: '←→', label: 'switch tab' },
              { key: 'tab', label: 'config' },
              { key: 'esc', label: 'back' },
            ]
        } />
      </Box>
    </Box>
  );
}

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { validateLlamaCppDir, loadStoredConfig, saveUserConfig } from '../config.js';
import type { StoredConfig } from '../types.js';
import { theme } from '../theme.js';

interface FirstRunSetupProps {
  onDone: () => void;
}

type Step = 'path' | 'host' | 'port';

const HOST_OPTIONS = [
  { value: '127.0.0.1', label: 'Local only (127.0.0.1)', desc: 'Only this machine can connect' },
  { value: '0.0.0.0', label: 'LAN accessible (0.0.0.0)', desc: 'Other devices on your network can connect' },
];

export function FirstRunSetup({ onDone }: FirstRunSetupProps) {
  const [step, setStep] = useState<Step>('path');
  const [llamaCppDir, setLlamaCppDir] = useState('');
  const [pathError, setPathError] = useState('');
  const [hostIndex, setHostIndex] = useState(1);
  const [portValue, setPortValue] = useState('8484');
  const [portError, setPortError] = useState('');

  const handlePathSubmit = (value: string) => {
    const trimmed = value.trim();
    const result = validateLlamaCppDir(trimmed);
    if (!result.ok) {
      setPathError(result.error!);
      return;
    }
    setPathError('');
    setLlamaCppDir(trimmed);
    setStep('host');
  };

  const handlePortSubmit = (value: string) => {
    const port = parseInt(value, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      setPortError('Port must be between 1 and 65535');
      return;
    }
    setPortError('');
    const defaults = loadStoredConfig();
    const config: StoredConfig = {
      ...defaults,
      llamaCppDir,
      host: HOST_OPTIONS[hostIndex].value,
      port,
    };
    saveUserConfig(config);
    onDone();
  };

  useInput((input, key) => {
    if (step === 'host') {
      if (key.upArrow || key.downArrow) {
        setHostIndex(i => (i === 0 ? 1 : 0));
      } else if (key.return) {
        setStep('port');
      } else if (key.escape) {
        setStep('path');
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Header title="FIRST-RUN SETUP" subtitle="Configure llama.cpp launcher" />

      {step === 'path' && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={theme.accent} bold>Step 1 of 3</Text>
          <Box marginTop={1}>
            <Text>Path to your llama.cpp directory:</Text>
          </Box>
          <Box marginTop={0}>
            <Text dimColor>  Example: C:\Users\Arthur\ai\llama.cpp</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.accent}>{' › '}</Text>
            <TextInput
              value={llamaCppDir}
              onChange={setLlamaCppDir}
              onSubmit={handlePathSubmit}
              placeholder="Enter path..."
            />
          </Box>
          {pathError && (
            <Box marginTop={1} flexDirection="column">
              {pathError.split('\n').map((line, i) => (
                <Text key={i} color={theme.danger}> {line}</Text>
              ))}
            </Box>
          )}
          <KeyHint hints={[{ key: '⏎', label: 'confirm' }]} />
        </Box>
      )}

      {step === 'host' && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={theme.accent} bold>Step 2 of 3</Text>
          <Box marginTop={1}>
            <Text>Server access mode:</Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {HOST_OPTIONS.map((opt, i) => (
              <Box key={opt.value}>
                <Text color={i === hostIndex ? theme.marker : undefined}>
                  {i === hostIndex ? ' › ' : '   '}
                </Text>
                <Text color={i === hostIndex ? 'white' : undefined} bold={i === hostIndex}>
                  {opt.label}
                </Text>
                <Text dimColor>  {opt.desc}</Text>
              </Box>
            ))}
          </Box>
          <KeyHint hints={[
            { key: '↑↓', label: 'select' },
            { key: '⏎', label: 'confirm' },
            { key: 'esc', label: 'back' },
          ]} />
        </Box>
      )}

      {step === 'port' && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={theme.accent} bold>Step 3 of 3</Text>
          <Box marginTop={1}>
            <Text>Server port:</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.accent}>{' › '}</Text>
            <TextInput
              value={portValue}
              onChange={setPortValue}
              onSubmit={handlePortSubmit}
              placeholder="8484"
            />
          </Box>
          {portError && (
            <Box marginTop={1}>
              <Text color={theme.danger}> {portError}</Text>
            </Box>
          )}
          <KeyHint hints={[{ key: '⏎', label: 'save & continue' }]} />
        </Box>
      )}
    </Box>
  );
}

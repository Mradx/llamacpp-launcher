import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { InstallWizard } from './InstallWizard.js';
import { validateLlamaCppDir, loadStoredConfig, saveUserConfig } from '../config.js';
import { useTerminalViewport } from '../hooks/useTerminalViewport.js';
import { clampLines, truncateText } from '../utils/terminal.js';
import type { StoredConfig } from '../types.js';
import { theme } from '../theme.js';

interface FirstRunSetupProps {
  onDone: () => void;
}

type Step = 'path-choice' | 'path' | 'install' | 'host' | 'port';

const CHOICE_OPTIONS = [
  { label: 'Yes, I\'ll enter the path', desc: 'I have llama.cpp compiled' },
  { label: 'No, install it for me', desc: 'Clone and build automatically' },
];

const HOST_OPTIONS = [
  { value: '127.0.0.1', label: 'Local only (127.0.0.1)', desc: 'Only this machine can connect' },
  { value: '0.0.0.0', label: 'LAN accessible (0.0.0.0)', desc: 'Other devices on your network can connect' },
];

export function FirstRunSetup({ onDone }: FirstRunSetupProps) {
  const { rows, columns } = useTerminalViewport();
  const [step, setStep] = useState<Step>('path-choice');
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [llamaCppDir, setLlamaCppDir] = useState('');
  const [pathError, setPathError] = useState('');
  const [hostIndex, setHostIndex] = useState(1);
  const [defaultPort, setDefaultPort] = useState('8484');
  const [portValue, setPortValue] = useState('');
  const [portError, setPortError] = useState('');
  const bodyHeight = Math.max(8, rows - 6);
  const lineWidth = Math.max(24, columns - 6);
  const exampleLlamaCppDir = `${process.env.USERPROFILE || 'C:\\Users\\Default'}\\ai\\llama.cpp`;

  useEffect(() => {
    setDefaultPort(String(loadStoredConfig().port));
  }, []);

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
    const portText = value.trim() || defaultPort;
    const port = Number(portText);
    if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
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
    if (step === 'path-choice') {
      if (key.upArrow || key.downArrow) {
        setChoiceIndex(i => (i === 0 ? 1 : 0));
      } else if (key.return) {
        setStep(choiceIndex === 0 ? 'path' : 'install');
      }
    } else if (step === 'path') {
      if (key.escape) {
        setStep('path-choice');
      }
    } else if (step === 'host') {
      if (key.upArrow || key.downArrow) {
        setHostIndex(i => (i === 0 ? 1 : 0));
      } else if (key.return) {
        setStep('port');
      } else if (key.escape) {
        setStep(llamaCppDir ? 'path' : 'path-choice');
      }
    } else if (step === 'port') {
      if (key.escape) {
        setStep('host');
      }
    }
  });

  if (step === 'install') {
    return (
      <InstallWizard
        onDone={(dir) => {
          setLlamaCppDir(dir);
          setStep('host');
        }}
        onBack={() => setStep('path-choice')}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Header title="FIRST-RUN SETUP" subtitle="Configure llama.cpp launcher" />

      {step === 'path-choice' && (
        <Box flexDirection="column" marginLeft={2} height={bodyHeight}>
          <Text color={theme.accent} bold>Step 1 of 4</Text>
          <Box marginTop={1}>
            <Text>Do you have llama.cpp compiled?</Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {CHOICE_OPTIONS.map((opt, i) => (
              <Box key={i}>
                <Text color={i === choiceIndex ? theme.marker : undefined}>
                  {i === choiceIndex ? ' › ' : '   '}
                </Text>
                <Text color={i === choiceIndex ? 'white' : undefined} bold={i === choiceIndex}>
                  {opt.label}
                </Text>
                <Text dimColor>  {opt.desc}</Text>
              </Box>
            ))}
          </Box>
          <KeyHint hints={[
            { key: '↑↓', label: 'select' },
            { key: '⏎', label: 'confirm' },
          ]} />
        </Box>
      )}

      {step === 'path' && (
        <Box flexDirection="column" marginLeft={2} height={bodyHeight}>
          <Text color={theme.accent} bold>Step 2 of 4</Text>
          <Box marginTop={1}>
            <Text>Path to your llama.cpp directory:</Text>
          </Box>
          <Box marginTop={0}>
            <Text dimColor>{truncateText(`  Example: ${exampleLlamaCppDir}`, lineWidth)}</Text>
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
              {clampLines(pathError, 3, lineWidth).map((line, i) => (
                <Text key={i} color={theme.danger}> {line}</Text>
              ))}
            </Box>
          )}
          <KeyHint hints={[
            { key: '⏎', label: 'confirm' },
            { key: 'esc', label: 'back' },
          ]} />
        </Box>
      )}

      {step === 'host' && (
        <Box flexDirection="column" marginLeft={2} height={bodyHeight}>
          <Text color={theme.accent} bold>Step 3 of 4</Text>
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
        <Box flexDirection="column" marginLeft={2} height={bodyHeight}>
          <Text color={theme.accent} bold>Step 4 of 4</Text>
          <Box marginTop={1}>
            <Text>Server port:</Text>
          </Box>
          <Box marginTop={0}>
            <Text dimColor>  Default: {defaultPort}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.accent}>{' › '}</Text>
            <TextInput
              value={portValue}
              onChange={setPortValue}
              onSubmit={handlePortSubmit}
              placeholder={defaultPort}
            />
          </Box>
          {portError && (
            <Box marginTop={1}>
              <Text color={theme.danger}> {truncateText(portError, lineWidth)}</Text>
            </Box>
          )}
          <KeyHint hints={[{ key: '⏎', label: 'save & continue' }, { key: 'esc', label: 'back' }]} />
        </Box>
      )}
    </Box>
  );
}

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { useInstaller } from '../hooks/useInstaller.js';
import { getMissingPrerequisites, canAutoInstall, type PrerequisiteStatus, type InstallPhase } from '../services/installer.js';
import { theme } from '../theme.js';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

interface InstallWizardProps {
  onDone: (llamaCppDir: string) => void;
  onBack: () => void;
}

type WizardStep = 'prereq-check' | 'select-dir' | 'confirm' | 'installing' | 'complete' | 'failed';

const PHASES: InstallPhase[] = ['clone', 'build-ui', 'cmake-configure', 'cmake-build'];
const PHASE_LABELS: Record<InstallPhase, string> = {
  'clone': 'Cloning repository',
  'build-ui': 'Building web UI',
  'cmake-configure': 'CMake configure',
  'cmake-build': 'CMake build',
  'done': 'Done',
  'error': 'Error',
};

function phaseIndex(phase: InstallPhase): number {
  return PHASES.indexOf(phase);
}

export function InstallWizard({ onDone, onBack }: InstallWizardProps) {
  const {
    prereqs, checking, installing, progress,
    error, completed, startInstall, installPrereq, redetect,
  } = useInstaller();

  const [step, setStep] = useState<WizardStep>('prereq-check');
  const [targetDir, setTargetDir] = useState('C:\\ai\\llama.cpp');
  const [dirError, setDirError] = useState('');
  const [autoInstalling, setAutoInstalling] = useState<string | null>(null);

  const missing = prereqs ? getMissingPrerequisites(prereqs) : [];
  const criticalMissing = missing.filter(m => m !== 'NVM');
  const canProceed = prereqs && !checking && criticalMissing.length === 0;

  useInput((input, key) => {
    if (step === 'prereq-check' && !autoInstalling) {
      if (key.escape) {
        onBack();
      } else if (key.return && canProceed) {
        setStep('select-dir');
      } else if (input === 'r' || input === 'R') {
        redetect();
      } else if (input === 'i' || input === 'I') {
        const autoInstallable = missing.find(m => canAutoInstall(m));
        if (autoInstallable) {
          setAutoInstalling(autoInstallable);
          installPrereq(autoInstallable as 'Git' | 'NVM').then(() => {
            setAutoInstalling(null);
          });
        }
      }
    } else if (step === 'select-dir') {
      if (key.escape) {
        setStep('prereq-check');
      }
    } else if (step === 'confirm') {
      if (key.escape) {
        setStep('select-dir');
      } else if (key.return) {
        setStep('installing');
        startInstall(targetDir);
      }
    } else if (step === 'complete') {
      if (key.return) {
        onDone(targetDir);
      }
    } else if (step === 'failed') {
      if (key.return) {
        setStep('confirm');
      } else if (key.escape) {
        onBack();
      }
    }
  });

  useEffect(() => {
    if (step === 'installing' && completed) setStep('complete');
    if (step === 'installing' && error && !installing) setStep('failed');
  }, [step, completed, error, installing]);

  const handleDirSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setDirError('Path cannot be empty');
      return;
    }
    if (existsSync(trimmed)) {
      // allow if it's an existing llama.cpp clone
      if (existsSync(`${trimmed}\\.git`)) {
        setDirError('');
        setTargetDir(trimmed);
        setStep('confirm');
        return;
      }
      setDirError('Directory already exists. Choose an empty path or an existing llama.cpp clone.');
      return;
    }
    const parent = dirname(trimmed);
    if (!existsSync(parent)) {
      setDirError(`Parent directory does not exist: ${parent}`);
      return;
    }
    setDirError('');
    setTargetDir(trimmed);
    setStep('confirm');
  };

  return (
    <Box flexDirection="column">
      <Header title="INSTALL LLAMA.CPP" subtitle="Automated build setup" />

      {step === 'prereq-check' && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={theme.accent} bold>Prerequisites Check</Text>
          <Box marginTop={1} flexDirection="column">
            {checking ? (
              <Box>
                <Text color={theme.accent}><Spinner type="dots" /></Text>
                <Text> Detecting installed tools...</Text>
              </Box>
            ) : prereqs ? (
              <>
                <PrereqLine
                  label="Git"
                  found={prereqs.git.found}
                  detail={prereqs.git.version ? `v${prereqs.git.version}` : undefined}
                  hint={!prereqs.git.found ? 'winget install Git.Git' : undefined}
                />
                <PrereqLine
                  label="Visual Studio"
                  found={prereqs.cmake.found}
                  detail={prereqs.cmake.vsEdition ? `${prereqs.cmake.vsEdition} 2022` : undefined}
                  hint={!prereqs.cmake.found ? 'https://visualstudio.microsoft.com' : undefined}
                />
                <PrereqLine
                  label="CUDA Toolkit"
                  found={prereqs.cuda.found}
                  detail={prereqs.cuda.version ? `v${prereqs.cuda.version}` : undefined}
                  hint={!prereqs.cuda.found ? 'https://developer.nvidia.com/cuda-toolkit' : undefined}
                />
                <PrereqLine
                  label="Node.js"
                  found={prereqs.node.found}
                  detail={prereqs.node.version
                    ? `v${prereqs.node.version}${prereqs.node.nvmFound ? ' (NVM)' : ''}`
                    : undefined}
                  hint={!prereqs.node.found ? 'Optional: winget install CoreyButler.NVMforWindows' : undefined}
                  optional
                />
                <PrereqLine
                  label="NVIDIA GPU"
                  found={!!prereqs.gpu.name}
                  detail={prereqs.gpu.name
                    ? `${prereqs.gpu.name}${prereqs.gpu.arch ? ` (sm_${prereqs.gpu.arch})` : ''}`
                    : undefined}
                />

                <Box marginTop={1}>
                  <Text dimColor>  CPU cores: {prereqs.cpuCores} (parallel build)</Text>
                </Box>

                {autoInstalling && (
                  <Box marginTop={1}>
                    <Text color={theme.accent}><Spinner type="dots" /></Text>
                    <Text> Installing {autoInstalling} via winget...</Text>
                  </Box>
                )}

                {criticalMissing.length > 0 && !autoInstalling && (
                  <Box marginTop={1} flexDirection="column">
                    <Text color={theme.danger}>
                      Missing: {criticalMissing.join(', ')}
                    </Text>
                    <Text dimColor>  Install the missing tools and press [R] to re-check</Text>
                    {missing.some(m => canAutoInstall(m)) && (
                      <Text dimColor>  Press [I] to auto-install via winget</Text>
                    )}
                  </Box>
                )}
              </>
            ) : null}
          </Box>

          <KeyHint hints={[
            ...(canProceed ? [{ key: '⏎', label: 'continue' }] : []),
            { key: 'R', label: 're-check' },
            ...(missing.some(m => canAutoInstall(m)) ? [{ key: 'I', label: 'auto-install' }] : []),
            { key: 'esc', label: 'back' },
          ]} />
        </Box>
      )}

      {step === 'select-dir' && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={theme.accent} bold>Installation Directory</Text>
          <Box marginTop={1}>
            <Text>Where to clone & build llama.cpp:</Text>
          </Box>
          <Box marginTop={0}>
            <Text dimColor>  The repository will be cloned to this path</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.accent}>{' › '}</Text>
            <TextInput
              value={targetDir}
              onChange={setTargetDir}
              onSubmit={handleDirSubmit}
              placeholder="C:\ai\llama.cpp"
            />
          </Box>
          {dirError && (
            <Box marginTop={1} flexDirection="column">
              {dirError.split('\n').map((line, i) => (
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

      {step === 'confirm' && prereqs && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={theme.accent} bold>Confirm Installation</Text>
          <Box marginTop={1} flexDirection="column">
            <ConfirmRow label="Directory" value={targetDir} />
            <ConfirmRow label="GPU" value={prereqs.gpu.name ?? 'not detected'} />
            {prereqs.gpu.arch && (
              <ConfirmRow label="CUDA arch" value={`sm_${prereqs.gpu.arch}`} />
            )}
            <ConfirmRow label="CUDA" value={prereqs.cuda.version ? `v${prereqs.cuda.version}` : 'not found'} />
            <ConfirmRow label="Compiler" value={prereqs.cmake.vsEdition ? `VS 2022 ${prereqs.cmake.vsEdition}` : 'not found'} />
            <ConfirmRow label="Build jobs" value={`-j ${prereqs.cpuCores}`} />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>  This will clone ~500MB and compile llama-server.exe.</Text>
          </Box>
          <Box>
            <Text dimColor>  Build may take 5-15 minutes depending on hardware.</Text>
          </Box>
          <KeyHint hints={[
            { key: '⏎', label: 'start build' },
            { key: 'esc', label: 'back' },
          ]} />
        </Box>
      )}

      {step === 'installing' && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={theme.accent} bold>Installing...</Text>
          <Box marginTop={1} flexDirection="column">
            {PHASES.map((phase, i) => {
              const currentIdx = progress ? phaseIndex(progress.phase) : -1;
              const isDone = i < currentIdx || progress?.phase === 'done';
              const isActive = i === currentIdx;

              return (
                <Box key={phase}>
                  <Text color={isDone ? theme.success : isActive ? theme.accent : theme.neutral}>
                    {isDone ? ' ✔ ' : isActive ? ' ' : ' ○ '}
                  </Text>
                  {isActive && !isDone && (
                    <Text color={theme.accent}><Spinner type="dots" /></Text>
                  )}
                  <Text
                    color={isDone ? theme.success : isActive ? 'white' : theme.neutral}
                    bold={isActive}
                  >
                    {' '}{PHASE_LABELS[phase]}
                  </Text>
                  {isActive && progress?.percent !== undefined && (
                    <Text dimColor> ({progress.percent}%)</Text>
                  )}
                </Box>
              );
            })}
          </Box>

          {progress?.detail && (
            <Box marginTop={1} marginLeft={3}>
              <Text dimColor wrap="truncate">
                {'> '}{progress.detail.slice(0, 80)}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {step === 'complete' && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={theme.success} bold>Installation Complete!</Text>
          <Box marginTop={1}>
            <Text>llama-server.exe built successfully at:</Text>
          </Box>
          <Box>
            <Text color={theme.accent}> {targetDir}\build\bin\Release</Text>
          </Box>
          <KeyHint hints={[{ key: '⏎', label: 'continue setup' }]} />
        </Box>
      )}

      {step === 'failed' && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={theme.danger} bold>Build Failed</Text>
          {progress && (
            <Box marginTop={1}>
              <Text dimColor>Phase: {PHASE_LABELS[progress.phase]}</Text>
            </Box>
          )}
          {error && (
            <Box marginTop={1} flexDirection="column">
              {error.split('\n').slice(0, 15).map((line, i) => (
                <Text key={i} color={theme.danger}> {line}</Text>
              ))}
            </Box>
          )}
          <KeyHint hints={[
            { key: '⏎', label: 'retry' },
            { key: 'esc', label: 'back' },
          ]} />
        </Box>
      )}
    </Box>
  );
}

// ── Sub-components ──

function PrereqLine({ label, found, detail, hint, optional }: {
  label: string;
  found: boolean;
  detail?: string;
  hint?: string;
  optional?: boolean;
}) {
  const color = found ? theme.success : (optional ? theme.warning : theme.danger);
  const icon = found ? '✔' : (optional ? '⚠' : '✖');
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color}> {icon} </Text>
        <Box width={18}>
          <Text color={found ? undefined : color}>{label}</Text>
        </Box>
        {detail && <Text dimColor>{detail}</Text>}
      </Box>
      {!found && hint && (
        <Box marginLeft={5}>
          <Text dimColor>{hint}</Text>
        </Box>
      )}
    </Box>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Box width={14}>
        <Text color={theme.accent}> {label}</Text>
      </Box>
      <Text>{value}</Text>
    </Box>
  );
}

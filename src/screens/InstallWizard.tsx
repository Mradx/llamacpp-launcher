import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { useInstaller } from '../hooks/useInstaller.js';
import { getCriticalMissing, getOptionalMissing, canAutoInstall, NODE_WEB_UI_REQUIREMENT, type PrerequisiteStatus, type InstallPhase } from '../services/installer.js';
import { useTerminalViewport } from '../hooks/useTerminalViewport.js';
import { clampLines, truncateText } from '../utils/terminal.js';
import { matchesShortcut } from '../utils/keyboard.js';
import { theme } from '../theme.js';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { isMac, serverBinaryName } from '../utils/platform.js';

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

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function InstallWizard({ onDone, onBack }: InstallWizardProps) {
  const { rows, columns } = useTerminalViewport();
  const {
    prereqs, checking, installing, progress,
    error, completed, startInstall, installPrereq, installAllMissing, redetect,
  } = useInstaller();

  const [step, setStep] = useState<WizardStep>('prereq-check');
  const [targetDir, setTargetDir] = useState(() =>
    isMac()
      ? join(homedir(), 'llama.cpp')
      : `${process.env.USERPROFILE || 'C:\\Users\\Default'}\\llama.cpp`);
  const [dirError, setDirError] = useState('');
  const [autoInstalling, setAutoInstalling] = useState<string | null>(null);
  const [autoInstallError, setAutoInstallError] = useState<string | null>(null);

  const criticalMissing = prereqs ? getCriticalMissing(prereqs) : [];
  const optionalMissing = prereqs ? getOptionalMissing(prereqs) : [];
  const allMissing = [...criticalMissing, ...optionalMissing];
  const canProceed = prereqs && !checking && criticalMissing.length === 0;
  const bodyHeight = Math.max(8, rows - 6);
  const lineWidth = Math.max(24, columns - 6);

  useInput((input, key) => {
    if (step === 'prereq-check' && !autoInstalling) {
      if (key.escape) {
        onBack();
      } else if (key.return && canProceed) {
        setStep('select-dir');
      } else if (matchesShortcut(input, 'r')) {
        redetect();
      } else if (matchesShortcut(input, 'i')) {
        const firstItem = criticalMissing.find(m => canAutoInstall(m));
        if (firstItem) {
          setAutoInstalling(firstItem);
          setAutoInstallError(null);
          installAllMissing((name) => {
            setAutoInstalling(name);
          }).then((result) => {
            setAutoInstalling(null);
            if (!result.ok) {
              setAutoInstallError(result.error || 'Auto-install failed');
            }
          }).catch((err) => {
            setAutoInstalling(null);
            setAutoInstallError(err instanceof Error ? err.message : String(err));
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
      if (existsSync(join(trimmed, '.git'))) {
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
      try {
        mkdirSync(parent, { recursive: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setDirError(`Cannot create parent directory: ${parent}\n${message}`);
        return;
      }
    }
    setDirError('');
    setTargetDir(trimmed);
    setStep('confirm');
  };

  return (
    <Box flexDirection="column">
      <Header title="INSTALL LLAMA.CPP" subtitle="Automated build setup" />

      {step === 'prereq-check' && (
        <Box flexDirection="column" marginLeft={2} height={bodyHeight}>
          <Text color={theme.accent} bold>Prerequisites Check</Text>
          <Box marginTop={1} flexDirection="column">
            {checking ? (
              <Box>
                <Text color={theme.accent}><Spinner type="dots" /></Text>
                <Text> Detecting installed tools...</Text>
              </Box>
            ) : prereqs ? (
              <>
                {isMac() ? (
                  <>
                    <PrereqLine
                      label="Git"
                      found={prereqs.git.found}
                      detail={prereqs.git.version ? `v${prereqs.git.version}` : undefined}
                      hint={!prereqs.git.found ? 'xcode-select --install (or: brew install git)' : undefined}
                    />
                    <PrereqLine
                      label="CMake"
                      found={prereqs.cmake.found}
                      detail={prereqs.cmake.found ? 'found' : undefined}
                      hint={!prereqs.cmake.found ? 'brew install cmake' : undefined}
                    />
                    <PrereqLine
                      label="Xcode CLT"
                      found={!!prereqs.compiler?.found}
                      detail={prereqs.compiler?.label ?? undefined}
                      hint={!prereqs.compiler?.found ? 'xcode-select --install' : undefined}
                    />
                    <PrereqLine
                      label="Node.js"
                      found={prereqs.node.found && prereqs.node.supported}
                      detail={prereqs.node.version
                        ? `v${prereqs.node.version}${prereqs.node.nvmFound ? ' (NVM)' : ''}`
                        : undefined}
                      hint={!prereqs.node.found
                        ? 'Optional: needed for web UI build (brew install node)'
                        : !prereqs.node.supported
                          ? `Requires Node.js ${NODE_WEB_UI_REQUIREMENT} for web UI build`
                          : undefined}
                      optional
                    />
                    <PrereqLine
                      label="Metal GPU"
                      found={!!prereqs.gpu.name}
                      detail={prereqs.gpu.name ?? undefined}
                      hint={!prereqs.gpu.name ? 'No Metal GPU detected; build will be CPU-only' : undefined}
                      optional
                    />
                    <PrereqLine
                      label="Homebrew"
                      found={!!prereqs.brew?.found}
                      detail={prereqs.brew?.found ? 'found' : undefined}
                      hint={!prereqs.brew?.found ? 'Optional: needed to auto-install CMake/Node — https://brew.sh' : undefined}
                      optional
                    />
                  </>
                ) : (
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
                      hint={!prereqs.cuda.found ? 'Optional: will build CPU-only without CUDA' : undefined}
                      optional
                    />
                    <PrereqLine
                      label="Node.js"
                      found={prereqs.node.found && prereqs.node.supported}
                      detail={prereqs.node.version
                        ? `v${prereqs.node.version}${prereqs.node.nvmFound ? ' (NVM)' : ''}`
                        : undefined}
                      hint={!prereqs.node.found
                        ? 'Optional: needed for web UI build'
                        : !prereqs.node.supported
                          ? `Requires Node.js ${NODE_WEB_UI_REQUIREMENT} for web UI build`
                          : undefined}
                      optional
                    />
                    <PrereqLine
                      label="NVIDIA GPU"
                      found={!!prereqs.gpu.name}
                      detail={prereqs.gpu.name
                        ? `${prereqs.gpu.name}${prereqs.gpu.arch ? ` (sm_${prereqs.gpu.arch})` : ''}`
                        : undefined}
                      hint={!prereqs.gpu.name ? 'Optional: will build CPU-only' : undefined}
                      optional
                    />
                  </>
                )}

                <Box marginTop={1}>
                  <Text dimColor>  CPU cores: {prereqs.cpuCores} (parallel build)</Text>
                </Box>

                {autoInstalling && (
                  <Box marginTop={1} flexDirection="column">
                    <Box>
                      <Text color={theme.accent}><Spinner type="dots" /></Text>
                      <Text bold> {autoInstalling}</Text>
                      {progress?.elapsed != null && (
                        <Text dimColor>  {formatElapsed(progress.elapsed)}</Text>
                      )}
                    </Box>
                    {progress?.message && (
                      <Box marginLeft={3}>
                        <Text dimColor>{truncateText(progress.message, lineWidth - 4)}</Text>
                      </Box>
                    )}
                    {progress?.stalled ? (
                      <Box marginLeft={3}>
                        <Text color={theme.warning}>{truncateText(`! ${progress.detail}`, lineWidth - 4)}</Text>
                      </Box>
                    ) : progress?.detail ? (
                      <Box marginLeft={3}>
                        <Text dimColor wrap="truncate">{truncateText(`> ${progress.detail}`, lineWidth - 4)}</Text>
                      </Box>
                    ) : null}
                  </Box>
                )}

                {autoInstallError && !autoInstalling && (
                  <Box marginTop={1} flexDirection="column">
                    {clampLines(autoInstallError, 4, lineWidth).map((line, i) => (
                      <Text key={i} color={theme.danger}> {line}</Text>
                    ))}
                  </Box>
                )}

                {criticalMissing.length > 0 && !autoInstalling && (
                  <Box marginTop={1} flexDirection="column">
                    <Text color={theme.danger}>
                      {truncateText(`Missing: ${criticalMissing.join(', ')}`, lineWidth)}
                    </Text>
                    <Text dimColor>{'  Install the missing tools and press [R] to re-check'}</Text>
                    {criticalMissing.some(m => canAutoInstall(m)) && (
                      <Text dimColor>{'  Press [I] to auto-install'}</Text>
                    )}
                  </Box>
                )}
              </>
            ) : null}
          </Box>

          <KeyHint hints={[
            ...(canProceed ? [{ key: '⏎', label: 'continue' }] : []),
            { key: 'R', label: 're-check' },
            ...(criticalMissing.some(m => canAutoInstall(m)) ? [{ key: 'I', label: 'auto-install' }] : []),
            { key: 'esc', label: 'back' },
          ]} />
        </Box>
      )}

      {step === 'select-dir' && (
        <Box flexDirection="column" marginLeft={2} height={bodyHeight}>
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
              placeholder={isMac() ? '~/llama.cpp' : '%USERPROFILE%\\llama.cpp'}
            />
          </Box>
          {dirError && (
            <Box marginTop={1} flexDirection="column">
              {clampLines(dirError, 3, lineWidth).map((line, i) => (
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
        <Box flexDirection="column" marginLeft={2} height={bodyHeight}>
          <Text color={theme.accent} bold>Confirm Installation</Text>
          <Box marginTop={1} flexDirection="column">
            <ConfirmRow label="Directory" value={targetDir} />
            {isMac() ? (
              <>
                <ConfirmRow label="Build mode" value={prereqs.gpu.name ? 'Metal (GPU accelerated)' : 'CPU-only'} />
                {prereqs.gpu.name && (
                  <ConfirmRow label="GPU" value={prereqs.gpu.name} />
                )}
                <ConfirmRow label="Compiler" value={prereqs.compiler?.label ?? 'Apple clang'} />
              </>
            ) : (
              <>
                <ConfirmRow label="Build mode" value={prereqs.cuda.found ? 'CUDA (GPU accelerated)' : 'CPU-only'} />
                {prereqs.gpu.name && (
                  <ConfirmRow label="GPU" value={`${prereqs.gpu.name}${prereqs.gpu.arch ? ` (sm_${prereqs.gpu.arch})` : ''}`} />
                )}
                {prereqs.cuda.version && (
                  <ConfirmRow label="CUDA" value={`v${prereqs.cuda.version}`} />
                )}
                <ConfirmRow label="Compiler" value={prereqs.cmake.vsEdition ? `VS 2022 ${prereqs.cmake.vsEdition}` : 'not found'} />
              </>
            )}
            <ConfirmRow label="Build jobs" value={`-j ${prereqs.cpuCores}`} />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>  This will clone ~500MB and compile {serverBinaryName()}.</Text>
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
        <Box flexDirection="column" marginLeft={2} height={bodyHeight}>
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
                {truncateText(`> ${progress.detail}`, lineWidth - 6)}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {step === 'complete' && (
        <Box flexDirection="column" marginLeft={2} height={bodyHeight}>
          <Text color={theme.success} bold>Installation Complete!</Text>
          <Box marginTop={1}>
            <Text>{serverBinaryName()} built successfully at:</Text>
          </Box>
          <Box>
            <Text color={theme.accent}> {truncateText(isMac() ? join(targetDir, 'build', 'bin') : `${targetDir}\\build\\bin\\Release`, lineWidth)}</Text>
          </Box>
          <KeyHint hints={[{ key: '⏎', label: 'continue setup' }]} />
        </Box>
      )}

      {step === 'failed' && (
        <Box flexDirection="column" marginLeft={2} height={bodyHeight}>
          <Text color={theme.danger} bold>Build Failed</Text>
          {progress && (
            <Box marginTop={1}>
              <Text dimColor>Phase: {PHASE_LABELS[progress.phase]}</Text>
            </Box>
          )}
          {error && (
            <Box marginTop={1} flexDirection="column">
              {clampLines(error, Math.max(3, bodyHeight - 5), lineWidth).map((line, i) => (
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
  const { columns } = useTerminalViewport();
  const maxLineWidth = Math.max(16, columns - 24);
  const color = found ? theme.success : (optional ? theme.warning : theme.danger);
  const icon = found ? '✔' : (optional ? '⚠' : '✖');
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color}> {icon} </Text>
        <Box width={18}>
          <Text color={found ? undefined : color}>{label}</Text>
        </Box>
        {detail && <Text dimColor>{truncateText(detail, maxLineWidth)}</Text>}
      </Box>
      {!found && hint && (
        <Box marginLeft={5}>
          <Text dimColor>{truncateText(hint, Math.max(16, columns - 10))}</Text>
        </Box>
      )}
    </Box>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  const { columns } = useTerminalViewport();
  return (
    <Box>
      <Box width={14}>
        <Text color={theme.accent}> {label}</Text>
      </Box>
      <Text>{truncateText(value, Math.max(12, columns - 18))}</Text>
    </Box>
  );
}

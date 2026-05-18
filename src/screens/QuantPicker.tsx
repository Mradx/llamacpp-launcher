import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { Header } from '../components/Header.js';
import { FitTable } from '../components/FitTable.js';
import { KeyHint } from '../components/KeyHint.js';
import { listGgufFiles } from '../services/huggingface.js';
import { formatMb } from '../utils/format.js';
import type { HfFile, HardwareInfo } from '../types.js';
import { theme } from '../theme.js';

interface QuantPickerProps {
  repo: string;
  contextTokens: number;
  hardware: HardwareInfo | null;
  onSelect: (file: HfFile) => void;
  onBack: () => void;
}

export function QuantPicker({ repo, contextTokens, hardware, onSelect, onBack }: QuantPickerProps) {
  const [files, setFiles] = useState<HfFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      try {
        const result = await listGgufFiles(
          repo,
          contextTokens,
          hardware?.vramMb || 0,
          hardware?.ramMb || 0
        );
        if (!cancelled) {
          setFiles(result);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to fetch files');
          setLoading(false);
        }
      }
    }

    fetch();
    return () => { cancelled = true; };
  }, [repo, contextTokens, hardware]);

  useInput((input, key) => {
    if (loading) return;

    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex(i => Math.min(files.length - 1, i + 1));
    } else if (key.return && files.length > 0) {
      onSelect(files[selectedIndex]);
    }
  });

  return (
    <Box flexDirection="column">
      <Header title="SELECT QUANTIZATION" />

      <Box flexDirection="column" marginLeft={2} marginBottom={1}>
        <Box>
          <Text dimColor>Repo: </Text>
          <Text bold>{repo}</Text>
        </Box>
        {hardware && (
          <Box>
            <Text dimColor>GPU: </Text>
            <Text>{hardware.gpuName} ({formatMb(hardware.vramMb)})</Text>
            <Text dimColor> │ RAM: </Text>
            <Text>{formatMb(hardware.ramMb)}</Text>
          </Box>
        )}
      </Box>

      {loading ? (
        <Box marginLeft={2}>
          <Text color={theme.warning}><Spinner type="dots" /></Text>
          <Text> Fetching available files...</Text>
        </Box>
      ) : error ? (
        <Box marginLeft={2} flexDirection="column">
          <Text color={theme.danger}>✖ {error}</Text>
          <Text dimColor>  Press esc to go back</Text>
        </Box>
      ) : files.length === 0 ? (
        <Box marginLeft={2}>
          <Text dimColor italic>No GGUF files found in this repository</Text>
        </Box>
      ) : (
        <Box marginLeft={2}>
          <FitTable files={files} selectedIndex={selectedIndex} />
        </Box>
      )}

      <Box marginLeft={2}>
        <KeyHint hints={[
          { key: '↑↓', label: 'navigate' },
          { key: '⏎', label: 'select' },
          { key: 'esc', label: 'back' },
        ]} />
      </Box>
    </Box>
  );
}

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { Header } from '../components/Header.js';
import { FitTable } from '../components/FitTable.js';
import { KeyHint } from '../components/KeyHint.js';
import { listGgufFiles } from '../services/huggingface.js';
import { formatMb } from '../utils/format.js';
import { clampLines, truncateText } from '../utils/terminal.js';
import { useScrollableViewport } from '../hooks/useScrollableViewport.js';
import { useTerminalViewport } from '../hooks/useTerminalViewport.js';
import type { HfFile, HardwareInfo } from '../types.js';
import { theme } from '../theme.js';

interface QuantPickerProps {
  repo: string;
  contextTokens: number;
  hardware: HardwareInfo | null;
  selecting?: boolean;
  onSelect: (file: HfFile) => void;
  onBack: () => void;
}

export function QuantPicker({ repo, contextTokens, hardware, selecting, onSelect, onBack }: QuantPickerProps) {
  const [files, setFiles] = useState<HfFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { columns } = useTerminalViewport();
  const lineWidth = Math.max(24, columns - 6);
  const tableViewport = useScrollableViewport({
    itemCount: files.length,
    selectedIndex,
    reservedRows: selecting ? 17 : 15,
    minRows: 3,
  });
  const visibleFiles = files.slice(tableViewport.start, tableViewport.end);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setLoading(true);
      setError(null);
      try {
        const result = await listGgufFiles(
          repo,
          contextTokens,
          hardware?.vramMb || 0,
          hardware?.ramMb || 0
        );
        if (!cancelled) {
          setFiles(result);
          setSelectedIndex(0);
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

  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(0, files.length - 1)));
  }, [files.length]);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (loading || selecting) return;

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
          <Text bold>{truncateText(repo, Math.max(20, columns - 8))}</Text>
        </Box>
        {hardware && (
          <Box>
            <Text dimColor>GPU: </Text>
            <Text>{truncateText(`${hardware.gpuName} (${formatMb(hardware.vramMb)})`, Math.max(18, columns - 20))}</Text>
            <Text dimColor> | RAM: </Text>
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
          {clampLines(error, 5, lineWidth).map((line, i) => (
            <Text key={`${i}-${line}`} color={theme.danger}>{i === 0 ? 'x ' : '  '}{line}</Text>
          ))}
          <Text dimColor>  Press esc to go back</Text>
        </Box>
      ) : files.length === 0 ? (
        <Box marginLeft={2}>
          <Text dimColor italic>No GGUF files found in this repository</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginLeft={2}>
          {tableViewport.hasAbove && <Text dimColor>... more above</Text>}
          <FitTable
            files={visibleFiles}
            selectedIndex={selectedIndex}
            firstIndex={tableViewport.start}
          />
          {tableViewport.hasBelow && <Text dimColor>... more below</Text>}
        </Box>
      )}

      {selecting && (
        <Box marginLeft={2} marginTop={1}>
          <Text color={theme.warning}><Spinner type="dots" /></Text>
          <Text> Loading metadata...</Text>
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

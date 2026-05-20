import React, { useMemo, useState, useEffect } from 'react';
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
import type { HfFile, HardwareInfo, LocalModel } from '../types.js';
import { theme } from '../theme.js';

interface QuantPickerProps {
  repo: string;
  contextTokens: number;
  hardware: HardwareInfo | null;
  localModels: LocalModel[];
  selecting?: boolean;
  onSelect: (file: HfFile) => void;
  onBack: () => void;
  initialSelectedIndex?: number;
  onSelectedIndexChange?: (selectedIndex: number) => void;
}

function fileNameFromPath(path: string): string {
  return path.split('/').pop() || path;
}

function splitGroupKey(fileName: string): string {
  return fileName.replace(/\.gguf$/i, '').replace(/-\d{5}-of-\d{5}$/i, '');
}

function getDownloadedFileNames(repo: string, localModels: LocalModel[]): Set<string> {
  const lowerRepo = repo.toLowerCase();
  return new Set(
    localModels
      .filter(model => model.repoId.toLowerCase() === lowerRepo)
      .map(model => model.fileName),
  );
}

function markDownloaded(files: HfFile[], downloadedFileNames: Set<string>): HfFile[] {
  if (downloadedFileNames.size === 0) return files;
  const downloadedGroupKeys = new Set(
    [...downloadedFileNames].map(splitGroupKey),
  );

  return files.map(file => {
    const fileName = fileNameFromPath(file.path);
    const downloaded = downloadedFileNames.has(fileName)
      || downloadedGroupKeys.has(splitGroupKey(fileName));
    return downloaded ? { ...file, downloaded } : file;
  });
}

function downloadedQuantSummary(files: HfFile[]): string {
  return files
    .filter(file => file.downloaded)
    .map(file => file.metadata?.primaryQuantType || fileNameFromPath(file.path).replace(/\.gguf$/i, ''))
    .filter(Boolean)
    .join(', ');
}

export function QuantPicker({
  repo,
  contextTokens,
  hardware,
  localModels,
  selecting,
  onSelect,
  onBack,
  initialSelectedIndex,
  onSelectedIndexChange,
}: QuantPickerProps) {
  const [files, setFiles] = useState<HfFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex ?? 0);
  const { columns } = useTerminalViewport();
  const downloadedFileNames = useMemo(
    () => getDownloadedFileNames(repo, localModels),
    [repo, localModels],
  );
  const lineWidth = Math.max(24, columns - 6);
  const tableViewport = useScrollableViewport({
    itemCount: files.length,
    selectedIndex,
    reservedRows: selecting ? 18 : 16,
    minRows: 3,
  });
  const visibleFiles = files.slice(tableViewport.start, tableViewport.end);
  const downloadedSummary = downloadedQuantSummary(files);

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
          const nextFiles = markDownloaded(result, downloadedFileNames);
          setFiles(nextFiles);
          setSelectedIndex(Math.min(initialSelectedIndex ?? 0, Math.max(0, nextFiles.length - 1)));
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
  }, [repo, contextTokens, hardware, downloadedFileNames]);

  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(0, files.length - 1)));
  }, [files.length]);

  useEffect(() => {
    onSelectedIndexChange?.(selectedIndex);
  }, [onSelectedIndexChange, selectedIndex]);

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
        <Box>
          <Text dimColor>Downloaded: </Text>
          {downloadedSummary
            ? <Text color={theme.success}>{truncateText(downloadedSummary, Math.max(20, columns - 14))}</Text>
            : <Text dimColor>none</Text>
          }
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

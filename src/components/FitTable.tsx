import React from 'react';
import { Box, Text } from 'ink';
import type { HfFile, FitStatus } from '../types.js';

interface FitTableProps {
  files: HfFile[];
  selectedIndex: number;
}

function fitColor(status: FitStatus): string {
  switch (status) {
    case 'GPU_OK': return '#22c55e';
    case 'PARTIAL': return '#eab308';
    case 'RAM_OK': return '#38bdf8';
    case 'TOO_BIG': return '#ef4444';
  }
}

function fitLabel(status: FitStatus): string {
  switch (status) {
    case 'GPU_OK': return 'GPU OK';
    case 'PARTIAL': return 'PARTIAL';
    case 'RAM_OK': return 'RAM OK';
    case 'TOO_BIG': return 'TOO BIG';
  }
}

function truncateFileName(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 3) + '...';
}

export function FitTable({ files, selectedIndex }: FitTableProps) {
  return (
    <Box flexDirection="column">
      <Box marginBottom={0}>
        <Box width={4}><Text bold dimColor> # </Text></Box>
        <Box width={44}><Text bold dimColor>File</Text></Box>
        <Box width={10}><Text bold dimColor>Size</Text></Box>
        <Box width={10}><Text bold dimColor>Fit</Text></Box>
      </Box>
      <Box marginBottom={0}>
        <Text dimColor>{'─'.repeat(68)}</Text>
      </Box>
      {files.map((file, i) => {
        const isSelected = i === selectedIndex;
        const fileName = file.path.split('/').pop() || file.path;

        return (
          <Box key={file.path}>
            <Box width={4}>
              <Text color={isSelected ? '#d946ef' : undefined}>
                {isSelected ? '›' : ' '}{String(i + 1).padStart(2)}
              </Text>
            </Box>
            <Box width={44}>
              <Text color={isSelected ? 'white' : undefined} bold={isSelected}>
                {truncateFileName(fileName, 42)}
              </Text>
            </Box>
            <Box width={10}>
              <Text>{String(file.sizeGb).padStart(5)} GB</Text>
            </Box>
            <Box width={10}>
              <Text color={fitColor(file.fitStatus)} bold>
                {fitLabel(file.fitStatus)}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

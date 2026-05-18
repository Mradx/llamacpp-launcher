import React from 'react';
import { Box, Text } from 'ink';
import type { HfFile, FitStatus } from '../types.js';
import { fitStatusColor, theme } from '../theme.js';

interface FitTableProps {
  files: HfFile[];
  selectedIndex: number;
}

function fitLabel(status: FitStatus): string {
  switch (status) {
    case 'GPU_OK': return 'GPU OK';
    case 'PARTIAL': return 'PARTIAL';
    case 'RAM_OK': return 'RAM OK';
    case 'TOO_BIG': return 'TOO BIG';
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

function extractQuant(fileName: string): { baseName: string; quant: string } {
  const base = fileName.replace(/\.gguf$/i, '').replace(/-\d{5}-of-\d{5}$/, '');
  const match = base.match(/[-_]((?:UD[-_])?(?:I?Q\d[-_\w]*|[BF]F?\d+\w*))$/i);
  if (match) {
    return { baseName: base.slice(0, match.index!), quant: match[1] };
  }
  return { baseName: base, quant: '' };
}

export function FitTable({ files, selectedIndex }: FitTableProps) {
  return (
    <Box flexDirection="column">
      <Box marginBottom={0}>
        <Box width={4}><Text bold dimColor> # </Text></Box>
        <Box width={30}><Text bold dimColor>File</Text></Box>
        <Box width={16}><Text bold dimColor>Quant</Text></Box>
        <Box width={10}><Text bold dimColor>Size</Text></Box>
        <Box width={10}><Text bold dimColor>Fit</Text></Box>
      </Box>
      <Box marginBottom={0}>
        <Text dimColor>{'─'.repeat(70)}</Text>
      </Box>
      {files.map((file, i) => {
        const isSelected = i === selectedIndex;
        const fileName = file.path.split('/').pop() || file.path;
        const { baseName, quant } = extractQuant(fileName);
        const quantLabel = file.metadata?.primaryQuantType || quant;

        return (
          <Box key={file.path}>
            <Box width={4}>
              <Text color={isSelected ? theme.marker : undefined}>
                {isSelected ? '›' : ' '}{String(i + 1).padStart(2)}
              </Text>
            </Box>
            <Box width={30}>
              <Text color={isSelected ? 'white' : undefined} bold={isSelected}>
                {truncate(baseName, 28)}
              </Text>
            </Box>
            <Box width={16}>
              <Text color={isSelected ? 'white' : undefined} bold={isSelected}>
                {quantLabel}
              </Text>
            </Box>
            <Box width={10}>
              <Text>{String(file.sizeGb).padStart(5)} GB</Text>
            </Box>
            <Box width={10}>
              <Text color={fitStatusColor(file.fitStatus)} bold={isSelected}>
                {fitLabel(file.fitStatus)}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

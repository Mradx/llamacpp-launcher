import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { parseRawArgs, findUnknownArgs } from '../services/known-params.js';
import { useTerminalViewport } from '../hooks/useTerminalViewport.js';
import { clampLines, truncateText } from '../utils/terminal.js';
import { matchesShortcut } from '../utils/keyboard.js';
import { theme } from '../theme.js';

interface ExpertParamsProps {
  onConfirm: (rawArgs: string[]) => void;
  onBack: () => void;
}

function normalizeInputFragment(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function getCursorLine(lines: string[], cursorOffset: number): { lineIndex: number; column: number } {
  let remaining = cursorOffset;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (remaining <= line.length) {
      return { lineIndex, column: remaining };
    }
    remaining -= line.length + 1;
  }
  const lastLineIndex = Math.max(0, lines.length - 1);
  return { lineIndex: lastLineIndex, column: lines[lastLineIndex]?.length ?? 0 };
}

function getCursorOffsetForLine(lines: string[], lineIndex: number, column: number): number {
  let offset = 0;
  for (let index = 0; index < lineIndex; index++) {
    offset += lines[index].length + 1;
  }
  return offset + Math.min(column, lines[lineIndex]?.length ?? 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function renderInputLine(line: string, cursorColumn: number | null, maxWidth: number, placeholder?: string) {
  const width = Math.max(1, maxWidth);

  if (cursorColumn === null) {
    return <Text>{truncateText(line || ' ', width)}</Text>;
  }

  if (line.length === 0 && placeholder) {
    return (
      <Text>
        <Text inverse>{placeholder[0] ?? ' '}</Text>
        <Text dimColor>{truncateText(placeholder.slice(1), Math.max(1, width - 1))}</Text>
      </Text>
    );
  }

  if (cursorColumn >= line.length) {
    const beforeWidth = Math.max(0, width - 1);
    const start = Math.max(0, line.length - beforeWidth);
    const before = line.slice(start);
    return (
      <Text>
        {before}
        <Text inverse> </Text>
      </Text>
    );
  }

  const start = line.length <= width
    ? 0
    : clamp(cursorColumn - width + 1, 0, Math.max(0, line.length - width));
  const visible = line.slice(start, start + width);
  const visibleCursor = cursorColumn - start;
  const before = visible.slice(0, visibleCursor);
  const cursorChar = visible[visibleCursor] ?? ' ';
  const after = visible.slice(visibleCursor + 1);

  return (
    <Text>
      {before}
      <Text inverse>{cursorChar}</Text>
      {after}
    </Text>
  );
}

interface MultilineArgsInputProps {
  lines: string[];
  cursorLineIndex: number;
  cursorColumn: number;
  placeholder: string;
  scrollOffset: number;
  viewportHeight: number;
  lineWidth: number;
}

function MultilineArgsInput({
  lines,
  cursorLineIndex,
  cursorColumn,
  placeholder,
  scrollOffset,
  viewportHeight,
  lineWidth,
}: MultilineArgsInputProps) {
  const visibleLines = lines.slice(scrollOffset, scrollOffset + viewportHeight);

  return (
    <Box flexDirection="column" marginLeft={2} height={viewportHeight}>
      {visibleLines.map((line, offset) => {
        const lineIndex = scrollOffset + offset;
        return (
          <Box key={`${lineIndex}-${line}`}>
            <Text color={theme.accent} bold>{lineIndex === 0 ? '> ' : '  '}</Text>
            {renderInputLine(
              line,
              lineIndex === cursorLineIndex ? cursorColumn : null,
              lineWidth,
              lines.length === 1 && lines[0].length === 0 && lineIndex === 0 ? placeholder : undefined,
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export function ExpertParams({ onConfirm, onBack }: ExpertParamsProps) {
  const [input, setInput] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  const [inputScroll, setInputScroll] = useState(0);
  const [showConfirm, setShowConfirm] = useState(false);
  const [unknownArgs, setUnknownArgs] = useState<string[]>([]);
  const [parsedArgs, setParsedArgs] = useState<string[]>([]);
  const { rows, columns } = useTerminalViewport();
  const inputViewportHeight = Math.max(3, rows - 13);
  const lineWidth = Math.max(12, columns - 6);
  const inputLines = input.split('\n');
  const { lineIndex: cursorLineIndex, column } = getCursorLine(inputLines, cursorOffset);
  const maxInputScroll = Math.max(0, inputLines.length - inputViewportHeight);

  useEffect(() => {
    setInputScroll(prev => {
      let next = clamp(prev, 0, maxInputScroll);
      if (cursorLineIndex < next) {
        next = cursorLineIndex;
      } else if (cursorLineIndex >= next + inputViewportHeight) {
        next = cursorLineIndex - inputViewportHeight + 1;
      }
      return clamp(next, 0, maxInputScroll);
    });
  }, [cursorLineIndex, inputViewportHeight, maxInputScroll]);

  useInput((inputChar, key) => {
    if (showConfirm) {
      if (matchesShortcut(inputChar, 'y')) {
        onConfirm(parsedArgs);
      } else if (matchesShortcut(inputChar, 'n') || key.escape) {
        setShowConfirm(false);
        setUnknownArgs([]);
      }
      return;
    }

    if (key.escape) {
      onBack();
      return;
    }

    if (key.return) {
      handleSubmit(input);
      return;
    }

    if (key.leftArrow) {
      setCursorOffset(offset => Math.max(0, offset - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorOffset(offset => Math.min(input.length, offset + 1));
      return;
    }

    if (key.upArrow || key.downArrow) {
      const lines = input.split('\n');
      const cursor = getCursorLine(lines, cursorOffset);
      const nextLineIndex = key.upArrow
        ? Math.max(0, cursor.lineIndex - 1)
        : Math.min(lines.length - 1, cursor.lineIndex + 1);
      setCursorOffset(getCursorOffsetForLine(lines, nextLineIndex, cursor.column));
      return;
    }

    if (key.backspace) {
      if (cursorOffset > 0) {
        setInput(`${input.slice(0, cursorOffset - 1)}${input.slice(cursorOffset)}`);
        setCursorOffset(cursorOffset - 1);
      }
      return;
    }

    if (key.delete) {
      if (cursorOffset < input.length) {
        setInput(`${input.slice(0, cursorOffset)}${input.slice(cursorOffset + 1)}`);
      }
      return;
    }

    if (key.tab || (key.shift && key.tab)) {
      return;
    }

    if (key.ctrl && !matchesShortcut(inputChar, 'j')) {
      return;
    }

    const fragment = key.ctrl && matchesShortcut(inputChar, 'j') ? '\n' : normalizeInputFragment(inputChar);
    if (fragment.length > 0) {
      setInput(`${input.slice(0, cursorOffset)}${fragment}${input.slice(cursorOffset)}`);
      setCursorOffset(cursorOffset + fragment.length);
    }
  });

  const handleSubmit = (value: string) => {
    if (!value.trim()) {
      onConfirm([]);
      return;
    }

    const args = parseRawArgs(value.trim());
    const unknown = findUnknownArgs(args);

    if (unknown.length > 0) {
      setParsedArgs(args);
      setUnknownArgs(unknown);
      setShowConfirm(true);
    } else {
      onConfirm(args);
    }
  };

  const unknownLines = clampLines(unknownArgs.join('\n'), Math.max(1, rows - 14), lineWidth - 8);

  return (
    <Box flexDirection="column">
      <Header title="EXPERT PARAMETERS" subtitle="Enter raw llama-server generation flags" />

      <Box flexDirection="column" marginLeft={2} marginBottom={1}>
        <Text dimColor>{truncateText('Examples: --temp 0.8 --top-p 0.95 --top-k 40 --min-p 0.05', lineWidth)}</Text>
        <Text dimColor>{truncateText('          --presence-penalty 1.5 --frequency-penalty 0.5 --repeat-penalty 1.1', lineWidth)}</Text>
        <Text dimColor>  (empty = no sampling params)</Text>
      </Box>

      {!showConfirm && (
        <MultilineArgsInput
          lines={inputLines}
          cursorLineIndex={cursorLineIndex}
          cursorColumn={column}
          scrollOffset={inputScroll}
          viewportHeight={inputViewportHeight}
          lineWidth={lineWidth}
          placeholder="--temp 0.8 --top-k 40 ..."
        />
      )}

      {showConfirm && (
        <Box flexDirection="column" marginLeft={2}>
          <Box
            borderStyle="round"
            borderColor={theme.warning}
            paddingX={2}
            paddingY={0}
            flexDirection="column"
          >
            <Text color={theme.warning} bold> Unknown parameters detected:</Text>
            <Text> </Text>
            {unknownLines.map((arg, i) => (
              <Text key={`${i}-${arg}`} color={theme.warning}>  - {arg}</Text>
            ))}
            <Text> </Text>
            <Text dimColor>  These are not in the known llama-server generation docs.</Text>
            <Text dimColor>  They may still work if the server supports them.</Text>
            <Text> </Text>
            <Text>  Proceed anyway? <Text bold color={theme.success}>[Y]</Text>es / <Text bold color={theme.danger}>[N]</Text>o</Text>
          </Box>
        </Box>
      )}

      {!showConfirm && (
        <Box marginLeft={2}>
          <Text dimColor>
            Line {cursorLineIndex + 1}:{column + 1}  -  {inputLines.length} lines
            {maxInputScroll > 0 && inputScroll < maxInputScroll ? '  v' : ''}
            {inputScroll > 0 ? '  ^' : ''}
          </Text>
          <KeyHint hints={[
            { key: '⏎', label: 'submit' },
            { key: 'ctrl+j', label: 'new line' },
            { key: 'esc', label: 'back' },
          ]} />
        </Box>
      )}
    </Box>
  );
}

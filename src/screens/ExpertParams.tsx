import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { parseRawArgs, findUnknownArgs } from '../services/known-params.js';
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

function renderInputLine(line: string, cursorColumn: number | null, placeholder?: string) {
  if (cursorColumn === null) {
    return <Text>{line || ' '}</Text>;
  }

  if (line.length === 0 && placeholder) {
    return (
      <Text>
        <Text inverse>{placeholder[0] ?? ' '}</Text>
        <Text dimColor>{placeholder.slice(1)}</Text>
      </Text>
    );
  }

  const before = line.slice(0, cursorColumn);
  const cursorChar = line[cursorColumn] ?? ' ';
  const after = line.slice(cursorColumn + (line[cursorColumn] ? 1 : 0));

  return (
    <Text>
      {before}
      <Text inverse>{cursorChar}</Text>
      {after}
    </Text>
  );
}

interface MultilineArgsInputProps {
  value: string;
  cursorOffset: number;
  placeholder: string;
}

function MultilineArgsInput({ value, cursorOffset, placeholder }: MultilineArgsInputProps) {
  const lines = value.split('\n');
  const { lineIndex: cursorLineIndex, column } = getCursorLine(lines, cursorOffset);

  return (
    <Box flexDirection="column" marginLeft={2}>
      {lines.map((line, lineIndex) => (
        <Box key={`${lineIndex}-${line}`}>
          <Text color={theme.accent} bold>{lineIndex === 0 ? '> ' : '  '}</Text>
          {renderInputLine(
            line,
            lineIndex === cursorLineIndex ? column : null,
            value.length === 0 && lineIndex === 0 ? placeholder : undefined,
          )}
        </Box>
      ))}
    </Box>
  );
}

export function ExpertParams({ onConfirm, onBack }: ExpertParamsProps) {
  const [input, setInput] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  const [showConfirm, setShowConfirm] = useState(false);
  const [unknownArgs, setUnknownArgs] = useState<string[]>([]);
  const [parsedArgs, setParsedArgs] = useState<string[]>([]);

  useInput((inputChar, key) => {
    if (showConfirm) {
      if (inputChar === 'y' || inputChar === 'Y') {
        onConfirm(parsedArgs);
      } else if (inputChar === 'n' || inputChar === 'N' || key.escape) {
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

    if (key.ctrl && inputChar !== 'j') {
      return;
    }

    const fragment = key.ctrl && inputChar === 'j' ? '\n' : normalizeInputFragment(inputChar);
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

  return (
    <Box flexDirection="column">
      <Header title="EXPERT PARAMETERS" subtitle="Enter raw llama-server sampling flags" />

      <Box flexDirection="column" marginLeft={2} marginBottom={1}>
        <Text dimColor>Examples:</Text>
        <Text dimColor>  --temp 0.8 --top-p 0.95 --top-k 40 --min-p 0.05</Text>
        <Text dimColor>  --presence-penalty 1.5 --frequency-penalty 0.5 --repeat-penalty 1.1</Text>
        <Text dimColor>  (empty = no sampling params)</Text>
      </Box>

      {!showConfirm && (
        <MultilineArgsInput
          value={input}
          cursorOffset={cursorOffset}
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
            {unknownArgs.map(arg => (
              <Text key={arg} color={theme.warning}>  • {arg}</Text>
            ))}
            <Text> </Text>
            <Text dimColor>  These are not in the llama-server sampling docs.</Text>
            <Text dimColor>  They may still work if the server supports them.</Text>
            <Text> </Text>
            <Text>  Proceed anyway? <Text bold color={theme.success}>[Y]</Text>es / <Text bold color={theme.danger}>[N]</Text>o</Text>
          </Box>
        </Box>
      )}

      {!showConfirm && (
        <Box marginLeft={2}>
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

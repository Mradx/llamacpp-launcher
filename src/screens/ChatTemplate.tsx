import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { useTerminalViewport } from '../hooks/useTerminalViewport.js';
import { truncateText } from '../utils/terminal.js';
import { matchesShortcut } from '../utils/keyboard.js';
import { theme } from '../theme.js';

interface ChatTemplateProps {
  embeddedTemplate: string | undefined;
  currentOverride: string | undefined;
  onConfirm: (override: string | undefined) => void;
  onBack: () => void;
}

interface EditorSnapshot {
  text: string;
  cursor: number;
}

const MAX_UNDO = 100;

function highlightJinja(line: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const pattern = /(\{%[-+]?|[-+]?%\}|\{\{[-+]?|[-+]?\}\}|\{#|#\})/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<Text key={lastIndex}>{line.slice(lastIndex, match.index)}</Text>);
    }
    parts.push(<Text key={match.index} color={theme.accent} bold>{match[0]}</Text>);
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < line.length) {
    parts.push(<Text key={lastIndex}>{line.slice(lastIndex)}</Text>);
  }

  if (parts.length === 0) {
    parts.push(<Text key="empty"> </Text>);
  }

  return parts;
}

function normalizeInputFragment(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function getCursorLine(lines: string[], cursorOffset: number): { lineIndex: number; column: number } {
  let remaining = cursorOffset;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
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
    offset += lines[index]!.length + 1;
  }
  return offset + Math.min(column, lines[lineIndex]?.length ?? 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function renderEditLine(line: string, cursorColumn: number | null, maxWidth: number) {
  const width = Math.max(1, maxWidth);

  if (cursorColumn === null) {
    return <Text>{truncateText(line || ' ', width)}</Text>;
  }

  if (cursorColumn >= line.length) {
    const beforeWidth = Math.max(0, width - 1);
    const before = line.slice(Math.max(0, line.length - beforeWidth));
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

export function ChatTemplate({ embeddedTemplate, currentOverride, onConfirm, onBack }: ChatTemplateProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [override, setOverride] = useState(currentOverride);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [editInput, setEditInput] = useState('');
  const [editCursor, setEditCursor] = useState(0);
  const [editScroll, setEditScroll] = useState(0);
  const undoStack = useRef<EditorSnapshot[]>([]);
  const redoStack = useRef<EditorSnapshot[]>([]);
  const { rows, columns } = useTerminalViewport();
  const viewportHeight = Math.max(5, rows - 14);

  const activeTemplate = override ?? embeddedTemplate;
  const templateLines = useMemo(() => (activeTemplate ?? '').split('\n'), [activeTemplate]);
  const totalLines = templateLines.length;
  const maxScroll = Math.max(0, totalLines - viewportHeight);
  const visibleLines = templateLines.slice(scrollOffset, scrollOffset + viewportHeight);
  const lineNumWidth = String(totalLines).length;
  const viewLineWidth = Math.max(12, columns - lineNumWidth - 8);

  const editLines = editInput.split('\n');
  const editTotalLines = editLines.length;
  const editLineNumWidth = String(editTotalLines).length;
  const { lineIndex: cursorLineIndex, column } = getCursorLine(editLines, editCursor);
  const editMaxScroll = Math.max(0, editTotalLines - viewportHeight);
  const editVisibleLines = editLines.slice(editScroll, editScroll + viewportHeight);
  const editLineWidth = Math.max(12, columns - editLineNumWidth - 8);

  useEffect(() => {
    setScrollOffset(offset => Math.min(offset, maxScroll));
  }, [maxScroll]);

  useEffect(() => {
    if (mode !== 'edit') return;
    setEditScroll(prev => {
      let next = clamp(prev, 0, editMaxScroll);
      if (cursorLineIndex < next) {
        next = cursorLineIndex;
      } else if (cursorLineIndex >= next + viewportHeight) {
        next = cursorLineIndex - viewportHeight + 1;
      }
      return clamp(next, 0, editMaxScroll);
    });
  }, [cursorLineIndex, editMaxScroll, mode, viewportHeight]);

  const pushUndo = () => {
    undoStack.current.push({ text: editInput, cursor: editCursor });
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
  };

  const applyUndo = () => {
    const snap = undoStack.current.pop();
    if (!snap) return;
    redoStack.current.push({ text: editInput, cursor: editCursor });
    setEditInput(snap.text);
    setEditCursor(snap.cursor);
  };

  const applyRedo = () => {
    const snap = redoStack.current.pop();
    if (!snap) return;
    undoStack.current.push({ text: editInput, cursor: editCursor });
    setEditInput(snap.text);
    setEditCursor(snap.cursor);
  };

  const enterEdit = () => {
    const content = activeTemplate ?? '';
    setEditInput(content);
    setEditCursor(0);
    setEditScroll(0);
    undoStack.current = [];
    redoStack.current = [];
    setMode('edit');
  };

  const submitEdit = () => {
    const trimmed = editInput.trim();
    if (trimmed.length === 0 || trimmed === embeddedTemplate?.trim()) {
      setOverride(undefined);
      onConfirm(undefined);
    } else {
      setOverride(trimmed);
      onConfirm(trimmed);
    }
    setScrollOffset(0);
    setMode('view');
  };

  useInput((inputChar, key) => {
    if (mode === 'edit') {
      if (key.escape) {
        setMode('view');
        return;
      }

      if (key.return) {
        submitEdit();
        return;
      }

      if (key.ctrl && matchesShortcut(inputChar, 'z')) { applyUndo(); return; }
      if (key.ctrl && matchesShortcut(inputChar, 'y')) { applyRedo(); return; }

      if (key.ctrl && matchesShortcut(inputChar, 'k')) {
        pushUndo();
        setEditInput('');
        setEditCursor(0);
        return;
      }

      if (key.ctrl && matchesShortcut(inputChar, 'r')) {
        pushUndo();
        setEditInput(embeddedTemplate ?? '');
        setEditCursor(0);
        return;
      }

      if (key.pageUp || key.pageDown) {
        const lines = editInput.split('\n');
        const cur = getCursorLine(lines, editCursor);
        const jump = key.pageUp ? -viewportHeight : viewportHeight;
        const nextLine = Math.max(0, Math.min(lines.length - 1, cur.lineIndex + jump));
        setEditCursor(getCursorOffsetForLine(lines, nextLine, cur.column));
        return;
      }

      if (key.leftArrow) { setEditCursor(c => Math.max(0, c - 1)); return; }
      if (key.rightArrow) { setEditCursor(c => Math.min(editInput.length, c + 1)); return; }

      if (key.upArrow || key.downArrow) {
        const lines = editInput.split('\n');
        const cur = getCursorLine(lines, editCursor);
        const nextLine = key.upArrow
          ? Math.max(0, cur.lineIndex - 1)
          : Math.min(lines.length - 1, cur.lineIndex + 1);
        setEditCursor(getCursorOffsetForLine(lines, nextLine, cur.column));
        return;
      }

      if (key.backspace) {
        if (editCursor > 0) {
          pushUndo();
          setEditInput(`${editInput.slice(0, editCursor - 1)}${editInput.slice(editCursor)}`);
          setEditCursor(editCursor - 1);
        }
        return;
      }

      if (key.delete) {
        if (editCursor < editInput.length) {
          pushUndo();
          setEditInput(`${editInput.slice(0, editCursor)}${editInput.slice(editCursor + 1)}`);
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
        pushUndo();
        setEditInput(`${editInput.slice(0, editCursor)}${fragment}${editInput.slice(editCursor)}`);
        setEditCursor(editCursor + fragment.length);
      }
      return;
    }

    if (key.escape) {
      onBack();
      return;
    }

    if (key.upArrow) { setScrollOffset(s => Math.max(0, s - 1)); return; }
    if (key.downArrow) { setScrollOffset(s => Math.min(maxScroll, s + 1)); return; }
    if (key.pageUp) { setScrollOffset(s => Math.max(0, s - viewportHeight)); return; }
    if (key.pageDown) { setScrollOffset(s => Math.min(maxScroll, s + viewportHeight)); return; }

    if (matchesShortcut(inputChar, 'e')) {
      enterEdit();
      return;
    }

    if (matchesShortcut(inputChar, 'r')) {
      if (override !== undefined) {
        setOverride(undefined);
        onConfirm(undefined);
        setScrollOffset(0);
      }
      return;
    }
  });

  if (mode === 'edit') {
    return (
      <Box flexDirection="column">
        <Header title="CHAT TEMPLATE" subtitle="Editing template" />

        <Box flexDirection="column" marginLeft={2} marginBottom={1}>
          <Text dimColor>{truncateText('Edit the Jinja chat template below.', Math.max(12, columns - 4))}</Text>
          <Text dimColor>{truncateText('Submit empty to reset to model default.', Math.max(12, columns - 4))}</Text>
        </Box>

        <Box flexDirection="column" marginLeft={2} height={viewportHeight}>
          {editVisibleLines.map((line, i) => {
            const lineIndex = editScroll + i;
            return (
              <Box key={`${lineIndex}-${line.slice(0, 20)}`}>
                <Text color={theme.neutral}>
                  {String(lineIndex + 1).padStart(editLineNumWidth + 1)} {'│ '}
                </Text>
                {renderEditLine(
                  line,
                  lineIndex === cursorLineIndex ? column : null,
                  editLineWidth,
                )}
              </Box>
            );
          })}
        </Box>

        <Box marginLeft={2}>
          <Text dimColor>
            Line {cursorLineIndex + 1}:{column + 1}  -  {editTotalLines} lines
            {editMaxScroll > 0 && editScroll < editMaxScroll ? '  v' : ''}
            {editScroll > 0 ? '  ^' : ''}
          </Text>
        </Box>

        <Box marginLeft={2}>
          <KeyHint hints={[
            { key: '⏎', label: 'confirm' },
            { key: 'ctrl+j', label: 'new line' },
            { key: 'ctrl+z/y', label: 'undo/redo' },
            { key: 'ctrl+k', label: 'clear' },
            { key: 'ctrl+r', label: 'reset' },
            { key: 'esc', label: 'cancel' },
          ]} />
        </Box>
      </Box>
    );
  }

  const hasOverride = override !== undefined;
  const hasTemplate = activeTemplate !== undefined && activeTemplate.length > 0;

  return (
    <Box flexDirection="column">
      <Header
        title="CHAT TEMPLATE"
        subtitle={hasOverride ? 'Custom override active' : 'Template embedded in model'}
      />

      {!hasTemplate && (
        <Box marginLeft={2} marginBottom={1}>
          <Text color={theme.warning}>No chat template embedded in this model.</Text>
        </Box>
      )}

      {hasTemplate && (
        <Box flexDirection="column" marginLeft={2}>
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={theme.border}
            paddingX={1}
            height={viewportHeight + 2}
          >
            {visibleLines.map((line, i) => {
              const lineNum = scrollOffset + i + 1;
              return (
                <Box key={`${lineNum}-${line.slice(0, 20)}`}>
                  <Text color={theme.neutral}>
                    {String(lineNum).padStart(lineNumWidth)} {'│ '}
                  </Text>
                  <Text>{highlightJinja(truncateText(line, viewLineWidth))}</Text>
                </Box>
              );
            })}
          </Box>

          <Box marginLeft={1}>
            <Text dimColor>
              Lines {scrollOffset + 1}-{Math.min(scrollOffset + viewportHeight, totalLines)} of {totalLines}
              {maxScroll > 0 && scrollOffset < maxScroll ? '  v more below' : ''}
              {scrollOffset > 0 ? '  ^ more above' : ''}
            </Text>
          </Box>
        </Box>
      )}

      {hasOverride && (
        <Box marginLeft={2} marginTop={1}>
          <Text color={theme.warning}>Using custom override  </Text>
          <Text dimColor>(press </Text>
          <Text color={theme.accent} bold>r</Text>
          <Text dimColor> to reset to model default)</Text>
        </Box>
      )}

      <Box marginLeft={2}>
        <KeyHint hints={[
          ...(hasTemplate ? [{ key: '↑↓', label: 'scroll' }, { key: 'pgup/dn', label: 'page' }] : []),
          { key: 'e', label: 'edit' },
          ...(hasOverride ? [{ key: 'r', label: 'reset' }] : []),
          { key: 'esc', label: 'back' },
        ]} />
      </Box>
    </Box>
  );
}

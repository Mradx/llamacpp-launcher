import React, { useState, useMemo, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
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

function renderEditLine(line: string, cursorColumn: number | null) {
  if (cursorColumn === null) {
    return <Text>{line || ' '}</Text>;
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

export function ChatTemplate({ embeddedTemplate, currentOverride, onConfirm, onBack }: ChatTemplateProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [override, setOverride] = useState(currentOverride);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [editInput, setEditInput] = useState('');
  const [editCursor, setEditCursor] = useState(0);
  const [editScroll, setEditScroll] = useState(0);
  const undoStack = useRef<EditorSnapshot[]>([]);
  const redoStack = useRef<EditorSnapshot[]>([]);

  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 24;
  const viewportHeight = Math.max(5, termHeight - 14);

  const activeTemplate = override ?? embeddedTemplate;
  const templateLines = useMemo(() => (activeTemplate ?? '').split('\n'), [activeTemplate]);
  const totalLines = templateLines.length;
  const maxScroll = Math.max(0, totalLines - viewportHeight);
  const visibleLines = templateLines.slice(scrollOffset, scrollOffset + viewportHeight);
  const lineNumWidth = String(totalLines).length;

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

      // undo / redo
      if (key.ctrl && inputChar === 'z') { applyUndo(); return; }
      if (key.ctrl && inputChar === 'y') { applyRedo(); return; }

      // clear all content
      if (key.ctrl && inputChar === 'k') {
        pushUndo();
        setEditInput('');
        setEditCursor(0);
        return;
      }

      // reset to embedded template
      if (key.ctrl && inputChar === 'r') {
        pushUndo();
        setEditInput(embeddedTemplate ?? '');
        setEditCursor(0);
        return;
      }

      // page up / page down — move cursor by viewport
      if (key.pageUp || key.pageDown) {
        const lines = editInput.split('\n');
        const cur = getCursorLine(lines, editCursor);
        const jump = key.pageUp ? -viewportHeight : viewportHeight;
        const nextLine = Math.max(0, Math.min(lines.length - 1, cur.lineIndex + jump));
        setEditCursor(getCursorOffsetForLine(lines, nextLine, cur.column));
        return;
      }

      // cursor movement
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

      // deletions
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

      if (key.ctrl && inputChar !== 'j') {
        return;
      }

      // typing
      const fragment = key.ctrl && inputChar === 'j' ? '\n' : normalizeInputFragment(inputChar);
      if (fragment.length > 0) {
        pushUndo();
        setEditInput(`${editInput.slice(0, editCursor)}${fragment}${editInput.slice(editCursor)}`);
        setEditCursor(editCursor + fragment.length);
      }
      return;
    }

    // ── view mode ──

    if (key.escape) {
      onBack();
      return;
    }

    if (key.upArrow) { setScrollOffset(s => Math.max(0, s - 1)); return; }
    if (key.downArrow) { setScrollOffset(s => Math.min(maxScroll, s + 1)); return; }
    if (key.pageUp) { setScrollOffset(s => Math.max(0, s - viewportHeight)); return; }
    if (key.pageDown) { setScrollOffset(s => Math.min(maxScroll, s + viewportHeight)); return; }

    if (inputChar === 'e' || inputChar === 'E' || inputChar === 'у' || inputChar === 'У') {
      enterEdit();
      return;
    }

    if (inputChar === 'r' || inputChar === 'R' || inputChar === 'к' || inputChar === 'К') {
      if (override !== undefined) {
        setOverride(undefined);
        onConfirm(undefined);
        setScrollOffset(0);
      }
      return;
    }
  });

  // ── edit mode render ──

  if (mode === 'edit') {
    const editLines = editInput.split('\n');
    const editTotalLines = editLines.length;
    const editLineNumWidth = String(editTotalLines).length;
    const { lineIndex: cursorLineIndex, column } = getCursorLine(editLines, editCursor);

    let adjustedScroll = editScroll;
    if (cursorLineIndex < adjustedScroll) {
      adjustedScroll = cursorLineIndex;
    } else if (cursorLineIndex >= adjustedScroll + viewportHeight) {
      adjustedScroll = cursorLineIndex - viewportHeight + 1;
    }
    if (adjustedScroll !== editScroll) {
      setEditScroll(adjustedScroll);
    }

    const editVisibleLines = editLines.slice(adjustedScroll, adjustedScroll + viewportHeight);
    const editMaxScroll = Math.max(0, editTotalLines - viewportHeight);

    return (
      <Box flexDirection="column">
        <Header title="CHAT TEMPLATE" subtitle="Editing template" />

        <Box flexDirection="column" marginLeft={2} marginBottom={1}>
          <Text dimColor>Edit the Jinja chat template below.</Text>
          <Text dimColor>Submit empty to reset to model default.</Text>
        </Box>

        <Box flexDirection="column" marginLeft={2}>
          {editVisibleLines.map((line, i) => {
            const lineIndex = adjustedScroll + i;
            return (
              <Box key={`${lineIndex}-${line.slice(0, 20)}`}>
                <Text color={theme.neutral}>
                  {String(lineIndex + 1).padStart(editLineNumWidth + 1)} {'│ '}
                </Text>
                {renderEditLine(
                  line,
                  lineIndex === cursorLineIndex ? column : null,
                )}
              </Box>
            );
          })}
        </Box>

        <Box marginLeft={2}>
          <Text dimColor>
            Line {cursorLineIndex + 1}:{column + 1}  ·  {editTotalLines} lines
            {editMaxScroll > 0 && adjustedScroll < editMaxScroll ? '  ↓' : ''}
            {adjustedScroll > 0 ? '  ↑' : ''}
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

  // ── view mode render ──

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
          >
            {visibleLines.map((line, i) => {
              const lineNum = scrollOffset + i + 1;
              return (
                <Box key={`${lineNum}-${line.slice(0, 20)}`}>
                  <Text color={theme.neutral}>
                    {String(lineNum).padStart(lineNumWidth)} {'│ '}
                  </Text>
                  <Text>{highlightJinja(line)}</Text>
                </Box>
              );
            })}
          </Box>

          <Box marginLeft={1}>
            <Text dimColor>
              Lines {scrollOffset + 1}-{Math.min(scrollOffset + viewportHeight, totalLines)} of {totalLines}
              {maxScroll > 0 && scrollOffset < maxScroll ? '  ↓ more below' : ''}
              {scrollOffset > 0 ? '  ↑ more above' : ''}
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

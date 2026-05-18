import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { parseRawArgs, findUnknownArgs } from '../services/known-params.js';

interface ExpertParamsProps {
  onConfirm: (rawArgs: string[]) => void;
  onBack: () => void;
}

export function ExpertParams({ onConfirm, onBack }: ExpertParamsProps) {
  const [input, setInput] = useState('');
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
        <Text dimColor>  --temp 0.8 --top-k 40 --top-p 0.95 --min-p 0.05</Text>
        <Text dimColor>  --mirostat 2 --mirostat-lr 0.1 --mirostat-ent 5.0</Text>
        <Text dimColor>  --dynatemp-range 0.5 --repeat-penalty 1.1</Text>
        <Text dimColor>  (empty = no sampling params)</Text>
      </Box>

      {!showConfirm && (
        <Box marginLeft={2}>
          <Text color="#8b5cf6" bold>{'> '}</Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder="--temp 0.8 --top-k 40 ..."
          />
        </Box>
      )}

      {showConfirm && (
        <Box flexDirection="column" marginLeft={2}>
          <Box
            borderStyle="round"
            borderColor="#eab308"
            paddingX={2}
            paddingY={0}
            flexDirection="column"
          >
            <Text color="#eab308" bold> Unknown parameters detected:</Text>
            <Text> </Text>
            {unknownArgs.map(arg => (
              <Text key={arg} color="#eab308">  • {arg}</Text>
            ))}
            <Text> </Text>
            <Text dimColor>  These are not in the llama-server sampling docs.</Text>
            <Text dimColor>  They may still work if the server supports them.</Text>
            <Text> </Text>
            <Text>  Proceed anyway? <Text bold color="#22c55e">[Y]</Text>es / <Text bold color="#ef4444">[N]</Text>o</Text>
          </Box>
        </Box>
      )}

      {!showConfirm && (
        <Box marginLeft={2}>
          <KeyHint hints={[
            { key: '⏎', label: 'submit' },
            { key: 'esc', label: 'back' },
          ]} />
        </Box>
      )}
    </Box>
  );
}

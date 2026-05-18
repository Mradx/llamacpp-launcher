import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { calculateLayerSplit, calculateMaxGpuLayers } from '../services/memory.js';
import { formatMb } from '../utils/format.js';

interface LayerPreset {
  name: string;
  layers: number;
}

interface LayerSelectProps {
  totalLayers: number;
  modelSizeMb: number;
  kvCacheMb: number;
  vramMb: number;
  ramMb: number;
  onSelect: (gpuLayers: number) => void;
  onBack: () => void;
}

function generatePresets(
  totalLayers: number,
  modelSizeMb: number,
  kvCacheMb: number,
  vramMb: number,
): LayerPreset[] {
  const maxGpu = calculateMaxGpuLayers(totalLayers, modelSizeMb, kvCacheMb, vramMb);
  const presets: LayerPreset[] = [];
  const seen = new Set<number>();

  const add = (name: string, layers: number) => {
    const clamped = Math.min(Math.max(0, layers), totalLayers);
    if (!seen.has(clamped)) {
      seen.add(clamped);
      presets.push({ name, layers: clamped });
    }
  };

  if (maxGpu >= totalLayers) {
    add('Full GPU', totalLayers);
  } else if (maxGpu > 0) {
    add('Recommended', maxGpu);
  }

  const threeQ = Math.round(totalLayers * 0.75);
  if (threeQ > 0 && threeQ < totalLayers) add('75% GPU', threeQ);

  const half = Math.round(totalLayers * 0.5);
  if (half > 0) add('Half GPU', half);

  const quarter = Math.round(totalLayers * 0.25);
  if (quarter > 0) add('25% GPU', quarter);

  add('CPU only', 0);

  return presets;
}

function MemoryBar({ label, color, usedMb, totalMb }: { label: string; color: string; usedMb: number; totalMb: number }) {
  const barWidth = 20;
  const pct = totalMb > 0 ? Math.min(100, Math.round(usedMb / totalMb * 100)) : 0;
  const filled = Math.round(Math.min(1, usedMb / totalMb) * barWidth);
  const barColor = pct > 95 ? '#ef4444' : pct > 80 ? '#eab308' : '#6366f1';

  return (
    <Box>
      <Box width={5}><Text color={color} bold>{label}</Text></Box>
      <Box width={12}><Text>{formatMb(usedMb).padStart(10)}</Text></Box>
      <Text dimColor> / </Text>
      <Box width={12}><Text dimColor>{formatMb(totalMb).padStart(10)}</Text></Box>
      <Text> </Text>
      <Text color={barColor}>{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(barWidth - filled)}</Text>
      <Text dimColor> {String(pct).padStart(3)}%</Text>
    </Box>
  );
}

function SplitPreview({ totalLayers, modelSizeMb, kvCacheMb, gpuLayers, vramMb, ramMb }: {
  totalLayers: number; modelSizeMb: number; kvCacheMb: number;
  gpuLayers: number; vramMb: number; ramMb: number;
}) {
  const split = calculateLayerSplit(totalLayers, modelSizeMb, kvCacheMb, gpuLayers);
  return (
    <Box flexDirection="column">
      <MemoryBar label="GPU" color="#22c55e" usedMb={split.gpuTotalMb} totalMb={vramMb} />
      <MemoryBar label="RAM" color="#38bdf8" usedMb={split.cpuTotalMb} totalMb={ramMb} />
    </Box>
  );
}

export function LayerSelect({ totalLayers, modelSizeMb, kvCacheMb, vramMb, ramMb, onSelect, onBack }: LayerSelectProps) {
  const [mode, setMode] = useState<'presets' | 'custom'>('presets');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const maxGpu = calculateMaxGpuLayers(totalLayers, modelSizeMb, kvCacheMb, vramMb);
  const [customLayers, setCustomLayers] = useState(maxGpu);

  const presets = generatePresets(totalLayers, modelSizeMb, kvCacheMb, vramMb);
  const itemCount = presets.length + 1;

  useInput((input, key) => {
    if (mode === 'presets') {
      if (key.escape) { onBack(); return; }
      if (key.upArrow) setSelectedIndex(i => Math.max(0, i - 1));
      else if (key.downArrow) setSelectedIndex(i => Math.min(itemCount - 1, i + 1));
      else if (key.return) {
        if (selectedIndex < presets.length) {
          onSelect(presets[selectedIndex].layers);
        } else {
          setMode('custom');
        }
      }
    } else {
      if (key.escape) { setMode('presets'); return; }
      if (key.leftArrow) setCustomLayers(l => Math.max(0, l - 1));
      else if (key.rightArrow) setCustomLayers(l => Math.min(totalLayers, l + 1));
      else if (key.return) onSelect(customLayers);
    }
  });

  if (mode === 'custom') {
    const barWidth = 30;
    const ratio = totalLayers > 0 ? customLayers / totalLayers : 0;
    const filled = Math.round(ratio * barWidth);

    return (
      <Box flexDirection="column">
        <Header title="GPU LAYERS" subtitle="Custom" />

        <Box flexDirection="column" marginLeft={2}>
          <Box marginBottom={1}>
            <Text bold>GPU Layers: </Text>
            <Text color="#d946ef" bold>{customLayers}</Text>
            <Text dimColor> / {totalLayers}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text color="#8b5cf6">{'◂ '}</Text>
            <Text color="#6366f1">{'█'.repeat(filled)}</Text>
            <Text dimColor>{'░'.repeat(barWidth - filled)}</Text>
            <Text color="#8b5cf6">{' ▸'}</Text>
          </Box>

          <SplitPreview
            totalLayers={totalLayers} modelSizeMb={modelSizeMb}
            kvCacheMb={kvCacheMb} gpuLayers={customLayers}
            vramMb={vramMb} ramMb={ramMb}
          />
        </Box>

        <Box marginLeft={2}>
          <KeyHint hints={[
            { key: '←→', label: 'adjust' },
            { key: '⏎', label: 'confirm' },
            { key: 'esc', label: 'back' },
          ]} />
        </Box>
      </Box>
    );
  }

  const highlightLayers = selectedIndex < presets.length
    ? presets[selectedIndex].layers
    : maxGpu;

  return (
    <Box flexDirection="column">
      <Header
        title="GPU LAYERS"
        subtitle={`${totalLayers} layers │ ${formatMb(modelSizeMb)} model │ ${formatMb(kvCacheMb)} KV cache`}
      />

      <Box flexDirection="column" marginLeft={2}>
        {presets.map((p, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={p.name}>
              <Text color={isSelected ? '#d946ef' : undefined}>
                {isSelected ? ' › ' : '   '}
              </Text>
              <Box width={4}>
                <Text color={isSelected ? 'white' : '#a1a1aa'} bold={isSelected}>
                  {i + 1}.
                </Text>
              </Box>
              <Box width={20}>
                <Text color={isSelected ? 'white' : undefined} bold={isSelected}>
                  {p.name}
                </Text>
              </Box>
              <Text dimColor>({p.layers} layers)</Text>
            </Box>
          );
        })}

        <Box>
          <Text color={selectedIndex === presets.length ? '#d946ef' : undefined}>
            {selectedIndex === presets.length ? ' › ' : '   '}
          </Text>
          <Box width={4}>
            <Text color={selectedIndex === presets.length ? 'white' : '#a1a1aa'} bold={selectedIndex === presets.length}>
              {presets.length + 1}.
            </Text>
          </Box>
          <Text color={selectedIndex === presets.length ? 'white' : undefined} bold={selectedIndex === presets.length}>
            Custom...
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        <SplitPreview
          totalLayers={totalLayers} modelSizeMb={modelSizeMb}
          kvCacheMb={kvCacheMb} gpuLayers={highlightLayers}
          vramMb={vramMb} ramMb={ramMb}
        />
      </Box>

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

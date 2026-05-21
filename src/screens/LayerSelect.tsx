import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { calculateLayerSplit, calculateMaxGpuLayers } from '../services/memory.js';
import { resolveGpuLayerPreferenceIndex, type GpuLayerPreference } from '../services/model-preferences.js';
import { formatMb, formatNumber } from '../utils/format.js';
import { theme, usageColor } from '../theme.js';
import type { ModelMetadata } from '../types.js';

interface LayerPreset {
  name: string;
  layers: number;
}

interface LayerSelectProps {
  totalLayers: number;
  modelSizeMb: number;
  kvCacheMb: number;
  kvCacheEstimated: boolean;
  metadata?: ModelMetadata;
  vramMb: number;
  ramMb: number;
  unifiedMemory: boolean;
  onSelect: (gpuLayers: number, preference: GpuLayerPreference) => void;
  onBack: () => void;
  initialSelectedIndex?: number;
  initialGpuPreference?: GpuLayerPreference;
  onSelectedIndexChange?: (selectedIndex: number) => void;
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

  presets.push({ name: 'Full GPU', layers: 999 });
  seen.add(999);
  if (maxGpu > 0 && maxGpu < totalLayers) {
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
  const barColor = usageColor(pct);

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

function UnifiedMemoryBar({ gpuUsedMb, cpuUsedMb, totalMb }: { gpuUsedMb: number; cpuUsedMb: number; totalMb: number }) {
  const barWidth = 20;
  const usedMb = gpuUsedMb + cpuUsedMb;
  const pct = totalMb > 0 ? Math.min(100, Math.round((usedMb / totalMb) * 100)) : 0;
  const filled = totalMb > 0 ? Math.round(Math.min(1, usedMb / totalMb) * barWidth) : 0;
  const gpuCells = totalMb > 0 ? Math.min(filled, Math.round(Math.min(1, gpuUsedMb / totalMb) * barWidth)) : 0;
  const cpuCells = Math.max(0, filled - gpuCells);
  const empty = barWidth - gpuCells - cpuCells;

  return (
    <Box>
      <Box width={9}><Text color={theme.ram} bold>Unified</Text></Box>
      <Box width={12}><Text>{formatMb(usedMb).padStart(10)}</Text></Box>
      <Text dimColor> / </Text>
      <Box width={12}><Text dimColor>{formatMb(totalMb).padStart(10)}</Text></Box>
      <Text> </Text>
      <Text color={theme.success}>{'█'.repeat(gpuCells)}</Text>
      <Text color={theme.ram}>{'█'.repeat(cpuCells)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>
      <Text dimColor> {String(pct).padStart(3)}%</Text>
    </Box>
  );
}

function SplitPreview({ totalLayers, modelSizeMb, kvCacheMb, gpuLayers, vramMb, ramMb, unifiedMemory }: {
  totalLayers: number; modelSizeMb: number; kvCacheMb: number;
  gpuLayers: number; vramMb: number; ramMb: number; unifiedMemory: boolean;
}) {
  const split = calculateLayerSplit(totalLayers, modelSizeMb, kvCacheMb, gpuLayers);
  if (unifiedMemory) {
    // Unified memory: one shared pool, so total RAM use is constant. The layer
    // count instead chooses *where compute runs* (Metal GPU vs CPU), shown as the
    // GPU/CPU split of one bar.
    const cpuLayers = totalLayers - split.gpuLayers;
    const gpuPct = totalLayers > 0 ? Math.round((split.gpuLayers / totalLayers) * 100) : 0;
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text dimColor>Unified memory: layers choose where to compute (GPU vs CPU), not how much RAM. More on GPU = faster.</Text>
        </Box>
        <UnifiedMemoryBar gpuUsedMb={split.gpuTotalMb} cpuUsedMb={split.cpuTotalMb} totalMb={ramMb} />
        <Box>
          <Box width={9}><Text bold>Compute</Text></Box>
          <Text color={theme.success}>{'█'} GPU {gpuPct}% </Text>
          <Text dimColor>{split.gpuLayers}/{totalLayers} · {formatMb(split.gpuTotalMb)}</Text>
          <Text>   </Text>
          <Text color={theme.ram}>{'█'} CPU {100 - gpuPct}% </Text>
          <Text dimColor>{cpuLayers}/{totalLayers} · {formatMb(split.cpuTotalMb)}</Text>
        </Box>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <MemoryBar label="GPU" color={theme.success} usedMb={split.gpuTotalMb} totalMb={vramMb} />
      <MemoryBar label="RAM" color={theme.ram} usedMb={split.cpuTotalMb} totalMb={ramMb} />
    </Box>
  );
}

function buildLayerSubtitle(
  totalLayers: number,
  modelSizeMb: number,
  kvCacheMb: number,
  kvCacheEstimated: boolean,
  metadata?: ModelMetadata
): string {
  const mtpSuffix = metadata?.nextNPredictLayers ? ` + ${metadata.nextNPredictLayers} MTP` : '';
  const parts = [`${totalLayers} layers${mtpSuffix}${metadata?.isEstimated ? ' estimated' : ''}`];
  if (metadata?.contextLength) {
    parts.push(`train ctx ${formatNumber(metadata.contextLength)}`);
  }
  if (metadata?.attentionHeadCountKv && metadata.attentionHeadCount) {
    const kvHeads = metadata.attentionHeadCountKvByLayer;
    if (kvHeads?.length) {
      const minKv = Math.min(...kvHeads);
      const maxKv = Math.max(...kvHeads);
      parts.push(`GQA ${minKv === maxKv ? minKv : `${minKv}-${maxKv}`}/${metadata.attentionHeadCount}`);
    } else {
      parts.push(`GQA ${metadata.attentionHeadCountKv.toFixed(metadata.attentionHeadCountKv % 1 === 0 ? 0 : 1)}/${metadata.attentionHeadCount}`);
    }
  }
  parts.push(`${formatMb(modelSizeMb)} model`);
  parts.push(`${formatMb(kvCacheMb)} KV cache${kvCacheEstimated ? ' estimated' : ''}`);
  return parts.join(' │ ');
}

export function LayerSelect({
  totalLayers,
  modelSizeMb,
  kvCacheMb,
  kvCacheEstimated,
  metadata,
  vramMb,
  ramMb,
  unifiedMemory,
  onSelect,
  onBack,
  initialSelectedIndex,
  initialGpuPreference,
  onSelectedIndexChange,
}: LayerSelectProps) {
  const maxGpu = calculateMaxGpuLayers(totalLayers, modelSizeMb, kvCacheMb, vramMb);
  const presets = generatePresets(totalLayers, modelSizeMb, kvCacheMb, vramMb);
  const itemCount = presets.length + 1;
  const preferredIndex = initialSelectedIndex
    ?? resolveGpuLayerPreferenceIndex(presets, initialGpuPreference, presets.length)
    ?? 0;
  const [mode, setMode] = useState<'presets' | 'custom'>('presets');
  const [selectedIndex, setSelectedIndex] = useState(() => (
    Math.min(preferredIndex, Math.max(0, itemCount - 1))
  ));
  const [customLayers, setCustomLayers] = useState(() => (
    Math.min(Math.max(0, initialGpuPreference?.type === 'custom' ? initialGpuPreference.layers : maxGpu), totalLayers)
  ));

  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(0, itemCount - 1)));
  }, [itemCount]);

  useEffect(() => {
    onSelectedIndexChange?.(selectedIndex);
  }, [onSelectedIndexChange, selectedIndex]);

  useInput((input, key) => {
    if (mode === 'presets') {
      if (key.escape) { onBack(); return; }
      if (key.upArrow) setSelectedIndex(i => Math.max(0, i - 1));
      else if (key.downArrow) setSelectedIndex(i => Math.min(itemCount - 1, i + 1));
      else if (key.return) {
        if (selectedIndex < presets.length) {
          onSelect(presets[selectedIndex].layers, { type: 'preset', layers: presets[selectedIndex].layers });
        } else {
          setMode('custom');
        }
      }
    } else {
      if (key.escape) { setMode('presets'); return; }
      if (key.leftArrow) setCustomLayers(l => Math.max(0, l - 1));
      else if (key.rightArrow) setCustomLayers(l => Math.min(totalLayers, l + 1));
      else if (key.return) onSelect(customLayers, { type: 'custom', layers: customLayers });
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
            <Text color={theme.marker} bold>{customLayers}</Text>
            <Text dimColor> / {totalLayers}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text color={theme.accent}>{'◂ '}</Text>
            <Text color={theme.progress}>{'█'.repeat(filled)}</Text>
            <Text dimColor>{'░'.repeat(barWidth - filled)}</Text>
            <Text color={theme.accent}>{' ▸'}</Text>
          </Box>

          <SplitPreview
            totalLayers={totalLayers} modelSizeMb={modelSizeMb}
            kvCacheMb={kvCacheMb} gpuLayers={customLayers}
            vramMb={vramMb} ramMb={ramMb} unifiedMemory={unifiedMemory}
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
    : customLayers;

  return (
    <Box flexDirection="column">
      <Header
        title="GPU LAYERS"
        subtitle={buildLayerSubtitle(totalLayers, modelSizeMb, kvCacheMb, kvCacheEstimated, metadata)}
      />

      <Box flexDirection="column" marginLeft={2}>
        {presets.map((p, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={p.name}>
              <Text color={isSelected ? theme.marker : undefined}>
                {isSelected ? ' › ' : '   '}
              </Text>
              <Box width={4}>
                <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
                  {i + 1}.
                </Text>
              </Box>
              <Box width={20}>
                <Text color={isSelected ? 'white' : undefined} bold={isSelected}>
                  {p.name}
                </Text>
              </Box>
              <Text dimColor>({p.layers >= 999 ? 'all' : `${p.layers} layers`})</Text>
            </Box>
          );
        })}

        <Box>
          <Text color={selectedIndex === presets.length ? theme.marker : undefined}>
            {selectedIndex === presets.length ? ' › ' : '   '}
          </Text>
          <Box width={4}>
            <Text color={selectedIndex === presets.length ? 'white' : theme.textMuted} bold={selectedIndex === presets.length}>
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
          vramMb={vramMb} ramMb={ramMb} unifiedMemory={unifiedMemory}
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

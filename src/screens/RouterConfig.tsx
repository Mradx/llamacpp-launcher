import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from '../components/Header.js';
import { KeyHint } from '../components/KeyHint.js';
import { useScrollableViewport } from '../hooks/useScrollableViewport.js';
import { useTerminalViewport } from '../hooks/useTerminalViewport.js';
import { CustomParams } from './CustomParams.js';
import { ExpertParams } from './ExpertParams.js';
import { findPreset } from '../services/presets.js';
import {
  ROUTER_SLEEP_OPTIONS,
  createRouterLaunchConfig,
  recommendedGpuLayers,
  writeRouterPreset,
} from '../services/router-preset.js';
import { formatNumber } from '../utils/format.js';
import { truncateText } from '../utils/terminal.js';
import type { Config, HardwareInfo, LocalModel, ModelParams, ParamsProfile, ReasoningMode, RouterLaunchConfig, RouterModelConfig } from '../types.js';
import { theme } from '../theme.js';

interface RouterConfigProps {
  models: LocalModel[];
  config: Config;
  hardware: HardwareInfo | null;
  onConfirm: (router: RouterLaunchConfig) => void;
  onBack: () => void;
}

type RouterRow =
  | { type: 'modelsMax' }
  | { type: 'autoload' }
  | { type: 'sleep' }
  | { type: 'model'; index: number }
  | { type: 'save' }
  | { type: 'launch' };

type RouterMode =
  | { type: 'list' }
  | { type: 'model'; index: number }
  | { type: 'custom-gpu'; index: number }
  | { type: 'custom-params'; index: number }
  | { type: 'expert'; index: number };

type ModelDetailRow =
  | 'enabled'
  | 'context'
  | 'gpu'
  | 'slots'
  | 'startup'
  | 'reasoning'
  | 'sampling'
  | 'custom'
  | 'expert'
  | 'clear'
  | 'back';

function formatGpuLayers(layers: number): string {
  if (layers >= 999) return 'all';
  if (layers <= 0) return 'CPU';
  return String(layers);
}

function AdjustableValue({ value, active, width }: { value: string; active: boolean; width?: number }) {
  const content = (
    <Text>
      <Text color={active ? theme.accent : theme.neutral}> {'◂'} </Text>
      <Text color={active ? 'white' : undefined}>{value}</Text>
      <Text color={active ? theme.accent : theme.neutral}> {'▸'}</Text>
    </Text>
  );
  if (width) {
    return <Box width={width}>{content}</Box>;
  }
  return content;
}

function formatSleep(seconds: number): string {
  if (seconds < 0) return 'off';
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${seconds / 60}m`;
}

function formatModelsMax(value: number): string {
  return value === 0 ? 'unlimited' : String(value);
}

function cycleNumber(value: number, options: number[], dir: -1 | 1): number {
  const currentIndex = options.indexOf(value);
  const index = currentIndex >= 0 ? currentIndex : 0;
  return options[(index + dir + options.length) % options.length];
}

const REASONING_MODES: ReasoningMode[] = ['auto', 'on', 'off'];

function cycleReasoningMode(value: ReasoningMode, dir: -1 | 1): ReasoningMode {
  const currentIndex = REASONING_MODES.indexOf(value);
  const index = currentIndex >= 0 ? currentIndex : 0;
  return REASONING_MODES[(index + dir + REASONING_MODES.length) % REASONING_MODES.length];
}

interface GpuLayerChoice {
  name: string;
  layers: number;
}

function totalModelLayers(model: RouterModelConfig): number {
  return (model.metadata?.blockCount ?? 0) + (model.metadata?.nextNPredictLayers ?? 0);
}

function gpuChoices(model: RouterModelConfig, hardware: HardwareInfo | null): GpuLayerChoice[] {
  const totalLayers = totalModelLayers(model);
  const choices: GpuLayerChoice[] = [];
  const seen = new Set<number>();

  const add = (name: string, layers: number) => {
    const clamped = layers >= 999 || totalLayers <= 0
      ? layers
      : Math.min(Math.max(0, layers), totalLayers);
    if (!seen.has(clamped)) {
      seen.add(clamped);
      choices.push({ name, layers: clamped });
    }
  };

  add('Full GPU', 999);

  if (totalLayers > 0) {
    const recommended = recommendedGpuLayers(model, hardware);
    if (recommended > 0 && recommended < totalLayers) {
      add('Recommended', recommended);
    }

    const threeQ = Math.round(totalLayers * 0.75);
    if (threeQ > 0 && threeQ < totalLayers) add('75% GPU', threeQ);

    const half = Math.round(totalLayers * 0.5);
    if (half > 0) add('Half GPU', half);

    const quarter = Math.round(totalLayers * 0.25);
    if (quarter > 0) add('25% GPU', quarter);
  }

  add('CPU only', 0);
  return choices;
}

function gpuChoiceLabel(model: RouterModelConfig, hardware: HardwareInfo | null): string {
  const match = gpuChoices(model, hardware).find(choice => choice.layers === model.gpuLayers);
  if (!match) return `Custom (${formatGpuLayers(model.gpuLayers)})`;
  return `${match.name} (${formatGpuLayers(match.layers)})`;
}

function cycleGpuLayers(model: RouterModelConfig, hardware: HardwareInfo | null, dir: -1 | 1): number {
  const choices = gpuChoices(model, hardware).map(choice => choice.layers);
  const currentIndex = choices.indexOf(model.gpuLayers);
  const index = currentIndex >= 0
    ? currentIndex
    : (dir > 0 ? -1 : 0);
  return choices[(index + dir + choices.length) % choices.length];
}

function modelIdentifier(model: RouterModelConfig): string {
  return `${model.repoId} ${model.fileName} ${model.label} ${model.alias}`;
}

function profileChoices(model: RouterModelConfig): Array<{ label: string; params: ModelParams | null }> {
  const preset = findPreset(modelIdentifier(model));
  const profiles = preset?.profiles || [];
  return [
    { label: 'llama.cpp defaults', params: null },
    ...profiles.map((profile: ParamsProfile) => ({
      label: `${preset?.name || 'Preset'}: ${profile.name}`,
      params: profile.params,
    })),
  ];
}

function formatParamsRaw(params: ModelParams): string {
  const parts: string[] = [];
  if (params.temp !== undefined) parts.push(`temp=${params.temp}`);
  if (params.top_k !== undefined) parts.push(`top_k=${params.top_k}`);
  if (params.top_p !== undefined) parts.push(`top_p=${params.top_p}`);
  if (params.min_p !== undefined) parts.push(`min_p=${params.min_p}`);
  if (params.presence_penalty !== undefined) parts.push(`pres=${params.presence_penalty}`);
  if (params.frequency_penalty !== undefined) parts.push(`freq=${params.frequency_penalty}`);
  if (params.repeat_penalty !== undefined) parts.push(`repeat=${params.repeat_penalty}`);
  return parts.join(', ');
}

function paramsSummary(model: RouterModelConfig): string {
  if (model.rawArgs.length > 0) return `Expert: ${model.rawArgs.join(' ')}`;
  if (model.params) {
    const raw = formatParamsRaw(model.params);
    return raw ? `${model.paramsLabel} (${raw})` : model.paramsLabel;
  }
  return model.paramsLabel;
}

export function RouterConfig({ models, config, hardware, onConfirm, onBack }: RouterConfigProps) {
  const [router, setRouter] = useState(() => createRouterLaunchConfig(models, config.contextOptions, config));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<RouterMode>({ type: 'list' });
  const [modelDetailIndex, setModelDetailIndex] = useState(0);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const { columns } = useTerminalViewport();
  const maxLineWidth = Math.max(24, columns - 10);

  const rows: RouterRow[] = useMemo(() => [
    { type: 'modelsMax' },
    { type: 'autoload' },
    { type: 'sleep' },
    ...router.models.map((_, index) => ({ type: 'model' as const, index })),
    { type: 'save' },
    { type: 'launch' },
  ], [router.models]);
  const modelDetailRows: ModelDetailRow[] = [
    'enabled',
    'context',
    'gpu',
    'slots',
    'startup',
    'reasoning',
    'sampling',
    'custom',
    'expert',
    'clear',
    'back',
  ];

  const enabledCount = router.models.filter(model => model.enabled).length;
  const listViewport = useScrollableViewport({
    itemCount: rows.length,
    selectedIndex,
    reservedRows: 11,
    minRows: 5,
    itemRows: 2,
  });
  const visibleRows = rows.slice(listViewport.start, listViewport.end);

  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  useEffect(() => {
    setModelDetailIndex(i => Math.min(i, modelDetailRows.length - 1));
  }, [modelDetailRows.length]);

  const updateModel = (index: number, update: (model: RouterModelConfig) => RouterModelConfig) => {
    setRouter(prev => ({
      ...prev,
      models: prev.models.map((model, i) => i === index ? update(model) : model),
    }));
  };

  const adjustSelected = (dir: -1 | 1) => {
    const row = rows[selectedIndex];
    if (!row) return;

    if (row.type === 'modelsMax') {
      setRouter(prev => ({
        ...prev,
        modelsMax: cycleNumber(prev.modelsMax, [1, 2, 3, 4, 0], dir),
      }));
    } else if (row.type === 'autoload') {
      setRouter(prev => ({ ...prev, autoload: !prev.autoload }));
    } else if (row.type === 'sleep') {
      setRouter(prev => ({
        ...prev,
        sleepIdleSeconds: cycleNumber(prev.sleepIdleSeconds, ROUTER_SLEEP_OPTIONS, dir),
      }));
    }
  };

  const toggleModelEnabled = (index: number) => {
    updateModel(index, model => ({ ...model, enabled: !model.enabled }));
  };

  const toggleModelStartup = (index: number) => {
    updateModel(index, model => ({ ...model, loadOnStartup: !model.loadOnStartup }));
  };

  const cycleModelProfile = (index: number, dir: -1 | 1) => {
    updateModel(index, model => {
      const choices = profileChoices(model);
      const currentIndex = choices.findIndex(choice => choice.label === model.paramsLabel && model.rawArgs.length === 0);
      const next = choices[(Math.max(0, currentIndex) + dir + choices.length) % choices.length];
      return {
        ...model,
        params: next.params,
        paramsLabel: next.label,
        rawArgs: [],
      };
    });
  };

  const setModelParams = (index: number, params: ModelParams, label: string) => {
    updateModel(index, model => ({
      ...model,
      params: Object.keys(params).length > 0 ? params : null,
      paramsLabel: Object.keys(params).length > 0 ? label : 'llama.cpp defaults',
      rawArgs: [],
    }));
    setMode({ type: 'model', index });
  };

  const setModelRawArgs = (index: number, rawArgs: string[]) => {
    updateModel(index, model => ({
      ...model,
      params: null,
      paramsLabel: rawArgs.length > 0 ? 'Expert flags' : 'llama.cpp defaults',
      rawArgs,
    }));
    setMode({ type: 'model', index });
  };

  const clearModelParams = (index: number) => {
    updateModel(index, model => ({
      ...model,
      params: null,
      paramsLabel: 'llama.cpp defaults',
      rawArgs: [],
    }));
  };

  const savePreset = (): boolean => {
    if (enabledCount === 0) {
      setStatus('');
      setError('Enable at least one model before saving models.ini.');
      return false;
    }

    try {
      writeRouterPreset(router, config.draftTokens);
      setError('');
      setStatus(`Saved ${router.presetPath}`);
      return true;
    } catch (err) {
      setStatus('');
      setError(err instanceof Error ? err.message : 'Failed to write models.ini');
      return false;
    }
  };

  const launch = () => {
    if (savePreset()) {
      onConfirm(router);
    }
  };

  useInput((input, key) => {
    if (mode.type === 'custom-params' || mode.type === 'expert') return;

    if (mode.type === 'custom-gpu') {
      const modelIndex = mode.index;
      const model = router.models[modelIndex];
      const totalLayers = model ? totalModelLayers(model) : 0;
      const maxLayers = totalLayers > 0 ? totalLayers : 999;

      if (key.escape || key.return) {
        setMode({ type: 'model', index: modelIndex });
        return;
      }
      if (key.leftArrow) {
        updateModel(modelIndex, current => ({
          ...current,
          gpuLayers: Math.max(0, Math.min(maxLayers, current.gpuLayers >= 999 ? maxLayers - 1 : current.gpuLayers - 1)),
        }));
        return;
      }
      if (key.rightArrow) {
        updateModel(modelIndex, current => ({
          ...current,
          gpuLayers: Math.min(maxLayers, current.gpuLayers >= 999 ? maxLayers : current.gpuLayers + 1),
        }));
        return;
      }
      return;
    }

    setError('');
    if (mode.type === 'model') {
      const modelIndex = mode.index;
      const row = modelDetailRows[modelDetailIndex];

      if (key.escape) {
        setMode({ type: 'list' });
        return;
      }
      if (key.upArrow) {
        setModelDetailIndex(i => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setModelDetailIndex(i => Math.min(modelDetailRows.length - 1, i + 1));
        return;
      }
      if (key.leftArrow || key.rightArrow) {
        const dir = key.rightArrow ? 1 : -1;
        if (row === 'context') {
          updateModel(modelIndex, model => ({
            ...model,
            contextSize: cycleNumber(model.contextSize, config.contextOptions, dir),
          }));
        } else if (row === 'gpu') {
          updateModel(modelIndex, model => ({
            ...model,
            gpuLayers: cycleGpuLayers(model, hardware, dir),
          }));
        } else if (row === 'slots') {
          updateModel(modelIndex, model => ({
            ...model,
            parallelSlots: dir > 0
              ? (model.parallelSlots >= 8 ? 1 : model.parallelSlots + 1)
              : (model.parallelSlots <= 1 ? 8 : model.parallelSlots - 1),
          }));
        } else if (row === 'sampling') {
          cycleModelProfile(modelIndex, dir);
        } else if (row === 'reasoning') {
          updateModel(modelIndex, model => ({
            ...model,
            reasoningMode: cycleReasoningMode(model.reasoningMode, dir),
          }));
        } else if (row === 'enabled') {
          toggleModelEnabled(modelIndex);
        } else if (row === 'startup') {
          toggleModelStartup(modelIndex);
        }
        return;
      }
      if (key.return) {
        if (row === 'enabled') {
          toggleModelEnabled(modelIndex);
        } else if (row === 'startup') {
          toggleModelStartup(modelIndex);
        } else if (row === 'sampling') {
          cycleModelProfile(modelIndex, 1);
        } else if (row === 'reasoning') {
          updateModel(modelIndex, model => ({
            ...model,
            reasoningMode: cycleReasoningMode(model.reasoningMode, 1),
          }));
        } else if (row === 'gpu') {
          setMode({ type: 'custom-gpu', index: modelIndex });
        } else if (row === 'custom') {
          setMode({ type: 'custom-params', index: modelIndex });
        } else if (row === 'expert') {
          setMode({ type: 'expert', index: modelIndex });
        } else if (row === 'clear') {
          clearModelParams(modelIndex);
        } else if (row === 'back') {
          setMode({ type: 'list' });
        }
        return;
      }
      return;
    }

    const row = rows[selectedIndex];

    setStatus('');
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(i => Math.min(rows.length - 1, i + 1));
      return;
    }
    if (key.leftArrow) {
      adjustSelected(-1);
      return;
    }
    if (key.rightArrow) {
      adjustSelected(1);
      return;
    }
    if (input === ' ' && row?.type === 'model') {
      toggleModelEnabled(row.index);
      return;
    }
    if (key.return) {
      if (row?.type === 'model') {
        setModelDetailIndex(0);
        setMode({ type: 'model', index: row.index });
      } else if (row?.type === 'autoload') {
        setRouter(prev => ({ ...prev, autoload: !prev.autoload }));
      } else if (row?.type === 'save') {
        savePreset();
      } else if (row?.type === 'launch') {
        launch();
      }
    }
  });

  const renderRow = (row: RouterRow, offset: number) => {
    const index = listViewport.start + offset;
    const isSelected = index === selectedIndex;

    if (row.type === 'modelsMax') {
      return (
        <Box key="modelsMax">
          <Text color={isSelected ? theme.marker : undefined}>{isSelected ? ' › ' : '   '}</Text>
          <Box width={24}><Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>Max loaded models</Text></Box>
          <AdjustableValue value={formatModelsMax(router.modelsMax)} active={isSelected} />
        </Box>
      );
    }

    if (row.type === 'autoload') {
      return (
        <Box key="autoload">
          <Text color={isSelected ? theme.marker : undefined}>{isSelected ? ' › ' : '   '}</Text>
          <Box width={24}><Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>Autoload on request</Text></Box>
          <AdjustableValue value={router.autoload ? 'on' : 'off'} active={isSelected} />
        </Box>
      );
    }

    if (row.type === 'sleep') {
      return (
        <Box key="sleep">
          <Text color={isSelected ? theme.marker : undefined}>{isSelected ? ' › ' : '   '}</Text>
          <Box width={24}><Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>Sleep idle</Text></Box>
          <AdjustableValue value={formatSleep(router.sleepIdleSeconds)} active={isSelected} />
        </Box>
      );
    }

    if (row.type === 'save' || row.type === 'launch') {
      const label = row.type === 'save'
        ? 'Save models.ini'
        : 'Save models.ini and launch router';
      return (
        <Box key={row.type} marginTop={row.type === 'save' ? 1 : 0}>
          <Text color={isSelected ? theme.marker : undefined}>{isSelected ? ' › ' : '   '}</Text>
          <Text color={enabledCount > 0 ? theme.success : theme.textMuted} bold={isSelected}>
            {label}
          </Text>
        </Box>
      );
    }

    const model = router.models[row.index];
    const isEnabled = model.enabled;
    const startup = model.loadOnStartup ? 'startup' : 'lazy';
    const meta = [
      model.repoId,
      model.mtpEnabled ? 'MTP' : undefined,
      model.reasoningMode !== 'auto' ? `reasoning ${model.reasoningMode}` : undefined,
      model.metadata?.primaryQuantType,
      paramsSummary(model),
    ].filter(Boolean).join(' · ');
    const gpuLabel = truncateText(gpuChoiceLabel(model, hardware), Math.max(8, Math.min(18, columns - 64)));

    return (
      <Box key={model.alias} flexDirection="column">
        <Box>
          <Text color={isSelected ? theme.marker : undefined}>{isSelected ? ' › ' : '   '}</Text>
          <Box width={4}><Text color={isEnabled ? theme.success : theme.textMuted}>{isEnabled ? '[x]' : '[ ]'}</Text></Box>
          <Box width={Math.min(34, Math.max(18, columns - 58))}>
            <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
              {truncateText(model.alias, Math.min(32, Math.max(16, columns - 60)))}
            </Text>
          </Box>
          <Text dimColor>ctx </Text>
          <Box width={8}><Text color={isSelected ? 'white' : undefined}>{formatNumber(model.contextSize)}</Text></Box>
          <Text dimColor> gpu </Text>
          <Text color={isSelected ? 'white' : undefined}>{gpuLabel}</Text>
          <Text dimColor> slots </Text>
          <Box width={3}><Text color={isSelected ? 'white' : undefined}>{model.parallelSlots}</Text></Box>
          <Text dimColor> {startup}</Text>
        </Box>
        <Box marginLeft={7}>
          <Text dimColor>{truncateText(meta || model.fileName, maxLineWidth)}</Text>
        </Box>
      </Box>
    );
  };

  if (mode.type === 'custom-gpu') {
    const model = router.models[mode.index];
    const totalLayers = model ? totalModelLayers(model) : 0;
    const maxLayers = totalLayers > 0 ? totalLayers : 999;
    const currentLayers = model?.gpuLayers ?? 0;

    return (
      <Box flexDirection="column">
        <Header title="GPU LAYERS" subtitle={model?.alias || 'Custom'} />

        <Box flexDirection="column" marginLeft={2}>
          <Box marginBottom={1}>
            <Text bold>GPU Layers: </Text>
            <AdjustableValue value={String(currentLayers >= 999 ? maxLayers : currentLayers)} active />
            {totalLayers > 0 && <Text dimColor> / {totalLayers}</Text>}
          </Box>

          <Text dimColor>{truncateText('Use exact layer count for this model in models.ini.', maxLineWidth)}</Text>
        </Box>

        <Box marginLeft={2} marginTop={1}>
          <KeyHint hints={[
            { key: '←→', label: 'adjust' },
            { key: '⏎', label: 'confirm' },
            { key: 'esc', label: 'back' },
          ]} />
        </Box>
      </Box>
    );
  }

  if (mode.type === 'custom-params') {
    return (
      <CustomParams
        onConfirm={(params) => setModelParams(mode.index, params, 'Custom')}
        onBack={() => setMode({ type: 'model', index: mode.index })}
      />
    );
  }

  if (mode.type === 'expert') {
    return (
      <ExpertParams
        onConfirm={(rawArgs) => setModelRawArgs(mode.index, rawArgs)}
        onBack={() => setMode({ type: 'model', index: mode.index })}
      />
    );
  }

  if (mode.type === 'model') {
    const model = router.models[mode.index];
    if (!model) {
      return (
        <Box flexDirection="column">
          <Header title="ROUTER MODEL" />
          <Box marginLeft={2}>
            <Text color={theme.warning}>Model no longer exists.</Text>
          </Box>
        </Box>
      );
    }

      const profileCount = Math.max(0, profileChoices(model).length - 1);
      const detailValues: Record<ModelDetailRow, string> = {
        enabled: model.enabled ? 'yes' : 'no',
        context: `${formatNumber(model.contextSize)} tokens`,
        gpu: gpuChoiceLabel(model, hardware),
        slots: String(model.parallelSlots),
        startup: model.loadOnStartup ? 'yes' : 'lazy',
        reasoning: model.reasoningMode,
        sampling: paramsSummary(model),
        custom: 'open sliders',
        expert: model.rawArgs.length > 0 ? model.rawArgs.join(' ') : 'raw llama-server flags',
        clear: 'llama.cpp defaults',
        back: 'return to router list',
      };
      const detailLabels: Record<ModelDetailRow, string> = {
        enabled: 'Enabled',
        context: 'Context',
        gpu: 'GPU layers',
        slots: 'Slots',
        startup: 'Load on startup',
        reasoning: 'Reasoning',
        sampling: profileCount > 0 ? `Sampling profile (${profileCount})` : 'Sampling profile',
        custom: 'Custom sampling',
        expert: 'Expert flags',
        clear: 'Clear params',
        back: 'Back',
      };

      return (
        <Box flexDirection="column">
          <Header title="ROUTER MODEL" subtitle={model.alias} />

          <Box flexDirection="column" marginLeft={2} marginBottom={1}>
            <Text dimColor>{truncateText(`${model.repoId} · ${model.fileName}`, maxLineWidth)}</Text>
          </Box>

          <Box flexDirection="column" marginLeft={2}>
            {modelDetailRows.map((row, index) => {
              const isSelected = index === modelDetailIndex;
              const adjustable = row === 'enabled' || row === 'context' || row === 'gpu' || row === 'slots' || row === 'startup' || row === 'reasoning' || row === 'sampling';
              return (
                <Box key={row}>
                  <Text color={isSelected ? theme.marker : undefined}>{isSelected ? ' › ' : '   '}</Text>
                  <Box width={22}>
                    <Text color={isSelected ? 'white' : theme.textMuted} bold={isSelected}>
                      {detailLabels[row]}
                    </Text>
                  </Box>
                  {adjustable ? (
                    <AdjustableValue value={truncateText(detailValues[row], Math.max(16, columns - 34))} active={isSelected} />
                  ) : (
                    <Text color={row === 'back' ? theme.textMuted : isSelected ? 'white' : undefined}>
                      {truncateText(detailValues[row], Math.max(16, columns - 30))}
                    </Text>
                  )}
                </Box>
              );
            })}
          </Box>

          <Box marginLeft={2} marginTop={1}>
            <KeyHint hints={[
              { key: '↑↓', label: 'navigate' },
              { key: '←→', label: 'adjust' },
              { key: '⏎', label: 'select/custom' },
              { key: 'esc', label: 'router' },
            ]} />
          </Box>
        </Box>
      );
  }

  return (
    <Box flexDirection="column">
      <Header title="ROUTER MODE" subtitle={`${enabledCount}/${router.models.length} models in models.ini`} />

      <Box flexDirection="column" marginLeft={2} marginBottom={1}>
        <Text dimColor>{truncateText(`Preset file: ${router.presetPath}`, maxLineWidth)}</Text>
        {error && <Text color={theme.danger}>{truncateText(error, maxLineWidth)}</Text>}
        {status && <Text color={theme.success}>{truncateText(status, maxLineWidth)}</Text>}
      </Box>

      {router.models.length === 0 ? (
        <Box marginLeft={2}>
          <Text color={theme.warning}>No local GGUF models found in the configured cache.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginLeft={2}>
          {listViewport.hasAbove && <Text dimColor>  ... more above</Text>}
          {visibleRows.map(renderRow)}
          {listViewport.hasBelow && <Text dimColor>  ... more below</Text>}
        </Box>
      )}

      <Box marginLeft={2}>
        <KeyHint hints={[
          { key: '↑↓', label: 'navigate' },
          ...(rows[selectedIndex]?.type === 'modelsMax' || rows[selectedIndex]?.type === 'autoload' || rows[selectedIndex]?.type === 'sleep'
            ? [{ key: '←→', label: 'adjust global' }]
            : []),
          ...(rows[selectedIndex]?.type === 'model'
            ? [{ key: 'space', label: 'enable/disable' }]
            : []),
          { key: '⏎', label: 'configure/launch' },
          { key: 'esc', label: 'back' },
        ]} />
      </Box>
    </Box>
  );
}

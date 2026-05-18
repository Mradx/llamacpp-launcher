import React, { useState, useMemo } from 'react';
import { Box, render, useApp } from 'ink';
import { statSync } from 'node:fs';
import { loadConfig } from './config.js';
import { useHardware } from './hooks/useHardware.js';
import { useModels } from './hooks/useModels.js';
import { detectMtp } from './services/mtp.js';
import { getProfiles, findPreset } from './services/presets.js';
import { saveToHistory } from './services/params-history.js';
import { estimateLayers, calculateKvCacheMb } from './services/memory.js';
import { fetchGgufMetadata, readGgufMetadata } from './services/gguf.js';
import { normalizeHfRef } from './utils/hf-url.js';
import { ModelSelect } from './screens/ModelSelect.js';
import { ContextSelect } from './screens/ContextSelect.js';
import { QuantPicker } from './screens/QuantPicker.js';
import { LayerSelect } from './screens/LayerSelect.js';
import { ParamsSelect } from './screens/ParamsSelect.js';
import { CustomParams } from './screens/CustomParams.js';
import { ExpertParams } from './screens/ExpertParams.js';
import type { Screen, ModelSelection, FullSelection, HfFile, ModelParams, Config, HardwareInfo, NetworkInfo } from './types.js';

export interface SelectionResult {
  config: Config;
  hardware: HardwareInfo | null;
  network: NetworkInfo | null;
  selection: FullSelection;
}

interface SelectionAppProps {
  onDone: (result: SelectionResult) => void;
}

function getModelIdentifier(model: ModelSelection): string {
  if (model.mode === 'local') return model.path + ' ' + model.label;
  return model.repo + ' ' + (model.file || '') + ' ' + model.label;
}

function SelectionApp({ onDone }: SelectionAppProps) {
  const config = useMemo(() => loadConfig(), []);
  const { hardware, network } = useHardware(config.port);
  const { models, loading: modelsLoading, deleteModel } = useModels(config.hfCachePath);
  const { exit } = useApp();

  const [screen, setScreen] = useState<Screen>('model-select');
  const [selectedModel, setSelectedModel] = useState<ModelSelection | null>(null);
  const [contextSize, setContextSize] = useState(config.defaultContext);
  const [modelSizeBytes, setModelSizeBytes] = useState<number | undefined>();
  const [modelTotalLayers, setModelTotalLayers] = useState<number | undefined>();
  const [gpuLayers, setGpuLayers] = useState(config.gpuLayers);
  const [didShowLayerSelect, setDidShowLayerSelect] = useState(false);

  const handleModelSelect = async (model: ModelSelection) => {
    setModelTotalLayers(undefined);

    if (model.mode === 'hf') {
      const { repo, quant } = normalizeHfRef(model.repo);
      model = { ...model, repo };
      if (quant) {
        model = { ...model, file: quant };
      }
    }
    if (model.mode === 'local') {
      try {
        setModelSizeBytes(statSync(model.path).size);
        setModelTotalLayers(readGgufMetadata(model.path)?.blockCount);
      } catch {
        setModelSizeBytes(undefined);
        setModelTotalLayers(undefined);
      }
    } else {
      setModelSizeBytes(undefined);
      if (model.file) {
        const metadata = await fetchGgufMetadata(model.repo, model.file).catch(() => null);
        setModelTotalLayers(metadata?.blockCount);
      }
    }
    setSelectedModel(model);
    setScreen('context-select');
  };

  const handleContextSelect = (ctx: number) => {
    setContextSize(ctx);
    if (selectedModel?.mode === 'hf' && !selectedModel.file) {
      setScreen('quant-picker');
    } else {
      goToLayersOrParams(ctx);
    }
  };

  const handleQuantSelect = (file: HfFile) => {
    if (selectedModel?.mode === 'hf') {
      const fileName = file.path.split('/').pop() || file.path;
      const updated: ModelSelection = {
        ...selectedModel,
        file: file.path,
        label: fileName.replace('.gguf', ''),
      };
      setSelectedModel(updated);
      setModelSizeBytes(file.sizeBytes);
      setModelTotalLayers(file.totalLayers);
      goToLayersOrParams(contextSize, file.sizeBytes);
    }
  };

  const goToLayersOrParams = (ctx: number, sizeOverride?: number) => {
    const size = sizeOverride ?? modelSizeBytes;
    if (size && hardware && hardware.vramMb > 0) {
      setDidShowLayerSelect(true);
      setScreen('layer-select');
      return;
    }
    setDidShowLayerSelect(false);
    setGpuLayers(config.gpuLayers);
    setScreen('params-select');
  };

  const handleLayerSelect = (layers: number) => {
    setGpuLayers(layers);
    setScreen('params-select');
  };

  const goBackFromParams = () => {
    if (didShowLayerSelect) {
      setScreen('layer-select');
    } else if (selectedModel?.mode === 'hf' && selectedModel.file) {
      setScreen('quant-picker');
    } else {
      setScreen('context-select');
    }
  };

  const goBackFromLayers = () => {
    if (selectedModel?.mode === 'hf' && selectedModel.file) {
      setScreen('quant-picker');
    } else {
      setScreen('context-select');
    }
  };

  const handleParamsSelect = (params: ModelParams | null) => {
    finalize(params, []);
  };

  const handleCustomConfirm = (params: ModelParams) => {
    const hasParams = Object.keys(params).length > 0;
    if (hasParams) {
      saveToHistory({ type: 'custom', params });
    }
    finalize(hasParams ? params : null, []);
  };

  const handleExpertConfirm = (rawArgs: string[]) => {
    if (rawArgs.length > 0) {
      saveToHistory({ type: 'expert', rawArgs, raw: rawArgs.join(' ') });
    }
    finalize(null, rawArgs);
  };

  const handleExpertDirect = (rawArgs: string[]) => {
    finalize(null, rawArgs);
  };

  const finalize = (params: ModelParams | null, rawArgs: string[]) => {
    const model = selectedModel!;
    const fullSelection: FullSelection = {
      model,
      contextSize,
      gpuLayers,
      mtpEnabled: detectMtp(
        model.mode === 'hf' ? model.repo : model.path,
        model.mode === 'hf' ? model.file : undefined
      ),
      params,
      rawArgs,
    };
    onDone({ config, hardware, network, selection: fullSelection });
    exit();
  };

  const handleQuit = () => {
    process.exit(0);
  };

  const modelIdentifier = selectedModel ? getModelIdentifier(selectedModel) : '';
  const preset = selectedModel ? findPreset(modelIdentifier) : null;
  const profiles = preset?.profiles || [];

  return (
    <Box flexDirection="column">
      {screen === 'model-select' && (
        <ModelSelect
          models={models}
          loading={modelsLoading}
          hfCachePath={config.hfCachePath}
          onSelect={handleModelSelect}
          onDelete={deleteModel}
          onQuit={handleQuit}
        />
      )}

      {screen === 'context-select' && (
        <ContextSelect
          options={config.contextOptions}
          defaultContext={config.defaultContext}
          modelSizeBytes={modelSizeBytes}
          totalLayers={modelTotalLayers}
          hardware={hardware}
          onSelect={handleContextSelect}
          onBack={() => setScreen('model-select')}
        />
      )}

      {screen === 'quant-picker' && selectedModel?.mode === 'hf' && (
        <QuantPicker
          repo={selectedModel.repo}
          contextTokens={contextSize}
          hardware={hardware}
          onSelect={handleQuantSelect}
          onBack={() => setScreen('context-select')}
        />
      )}

      {screen === 'layer-select' && modelSizeBytes && hardware && (
        <LayerSelect
          totalLayers={modelTotalLayers ?? estimateLayers(modelSizeBytes / (1024 ** 3))}
          modelSizeMb={Math.floor(modelSizeBytes / (1024 * 1024))}
          kvCacheMb={calculateKvCacheMb(
            contextSize,
            modelTotalLayers ?? estimateLayers(modelSizeBytes / (1024 ** 3))
          )}
          vramMb={hardware.vramMb}
          ramMb={hardware.ramMb}
          onSelect={handleLayerSelect}
          onBack={goBackFromLayers}
        />
      )}

      {screen === 'params-select' && (
        <ParamsSelect
          presetName={preset?.name || 'Model'}
          profiles={profiles}
          onSelect={handleParamsSelect}
          onCustom={() => setScreen('custom-params')}
          onExpert={() => setScreen('expert-params')}
          onExpertDirect={handleExpertDirect}
          onBack={goBackFromParams}
        />
      )}

      {screen === 'custom-params' && (
        <CustomParams
          onConfirm={handleCustomConfirm}
          onBack={() => setScreen('params-select')}
        />
      )}

      {screen === 'expert-params' && (
        <ExpertParams
          onConfirm={handleExpertConfirm}
          onBack={() => setScreen('params-select')}
        />
      )}
    </Box>
  );
}

export function runSelection(): Promise<SelectionResult> {
  return new Promise((resolve) => {
    const { waitUntilExit } = render(
      <SelectionApp onDone={resolve} />
    );
    waitUntilExit();
  });
}

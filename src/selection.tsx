import React, { useState, useMemo, useRef } from 'react';
import { Box, render, useApp } from 'ink';
import { statSync } from 'node:fs';
import { loadConfig, loadStoredConfig, saveUserConfig } from './config.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { useHardware } from './hooks/useHardware.js';
import { useModels } from './hooks/useModels.js';
import { detectMtp } from './services/mtp.js';
import { getProfiles, findPreset } from './services/presets.js';
import { saveToHistory } from './services/params-history.js';
import { loadTemplateOverride, saveTemplateOverride } from './services/template-overrides.js';
import { calculateKvCache, estimateModelMetadata, getEffectiveMetadata } from './services/memory.js';
import { useVersion } from './hooks/useVersion.js';
import { fetchGgufMetadata } from './services/gguf.js';
import { normalizeHfRef } from './utils/hf-url.js';
import { ModelSelect } from './screens/ModelSelect.js';
import { ContextSelect } from './screens/ContextSelect.js';
import { QuantPicker } from './screens/QuantPicker.js';
import { LayerSelect } from './screens/LayerSelect.js';
import { ParamsSelect } from './screens/ParamsSelect.js';
import { CustomParams } from './screens/CustomParams.js';
import { ExpertParams } from './screens/ExpertParams.js';
import { ChatTemplate } from './screens/ChatTemplate.js';
import { RouterConfig } from './screens/RouterConfig.js';
import type { Screen, ModelSelection, FullSelection, HfFile, ModelParams, Config, StoredConfig, HardwareInfo, NetworkInfo, RouterLaunchConfig, ModelMetadata } from './types.js';

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
  if (model.mode === 'router') return model.label;
  return model.repo + ' ' + (model.file || '') + ' ' + model.label;
}

export function shouldShowQuantPickerForContext(
  model: ModelSelection | null,
  nextContextSize: number,
  quantSelectedContextSize?: number,
): boolean {
  if (model?.mode !== 'hf') return false;
  if (!model.file) return true;
  return quantSelectedContextSize !== undefined && quantSelectedContextSize !== nextContextSize;
}

function SelectionApp({ onDone }: SelectionAppProps) {
  const [configVersion, setConfigVersion] = useState(0);
  const config = useMemo(() => loadConfig(), [configVersion]);
  const { hardware, network } = useHardware(config.port, config.host);
  const { models, loading: modelsLoading, deleteModel, refreshModels } = useModels(config.hfCachePath);
  const { version, refresh: refreshVersion } = useVersion(config.llamaCppDir);
  const { exit } = useApp();

  const [screen, setScreen] = useState<Screen>('model-select');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsConfig, setSettingsConfig] = useState<StoredConfig | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelSelection | null>(null);
  const [quantLoading, setQuantLoading] = useState(false);
  const quantCancelledRef = useRef(false);
  const defaultContext = config.contextOptions[Math.floor(config.contextOptions.length / 2)] || 64000;
  const [contextSize, setContextSize] = useState(defaultContext);
  const [modelSizeBytes, setModelSizeBytes] = useState<number | undefined>();
  const [modelMetadata, setModelMetadata] = useState<ModelMetadata | undefined>();
  const [quantSelectedContextSize, setQuantSelectedContextSize] = useState<number | undefined>();
  const [gpuLayers, setGpuLayers] = useState(99);
  const [didShowLayerSelect, setDidShowLayerSelect] = useState(false);
  const [chatTemplateOverride, setChatTemplateOverride] = useState<string | undefined>(undefined);
  const [modelSelectIndex, setModelSelectIndex] = useState(0);
  const [contextSelectIndex, setContextSelectIndex] = useState<number | undefined>();
  const [quantPickerIndex, setQuantPickerIndex] = useState<number | undefined>();
  const [layerSelectIndex, setLayerSelectIndex] = useState<number | undefined>();
  const [paramsSelectIndex, setParamsSelectIndex] = useState<number | undefined>();
  const [customParamsIndex, setCustomParamsIndex] = useState<number | undefined>();

  const handleModelSelect = async (model: ModelSelection) => {
    if (model.mode === 'router') return;
    setModelMetadata(model.metadata);

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
      } catch {
        setModelSizeBytes(undefined);
      }
    } else {
      setModelSizeBytes(undefined);
      if (model.file) {
        const metadata = await fetchGgufMetadata(model.repo, model.file).catch(() => null);
        model = { ...model, metadata: metadata ?? model.metadata };
        setModelMetadata(model.metadata);
      }
    }
    setChatTemplateOverride(loadTemplateOverride(model));
    setSelectedModel(model);
    setQuantSelectedContextSize(undefined);
    setContextSelectIndex(undefined);
    setScreen('context-select');
  };

  const handleContextSelect = (ctx: number) => {
    setContextSize(ctx);
    if (shouldShowQuantPickerForContext(selectedModel, ctx, quantSelectedContextSize)) {
      setQuantLoading(false);
      if (selectedModel?.mode === 'hf' && !selectedModel.file) {
        setQuantPickerIndex(undefined);
      }
      setScreen('quant-picker');
    } else {
      goToLayersOrParams(ctx);
    }
  };

  const handleQuantSelect = async (file: HfFile) => {
    quantCancelledRef.current = false;
    setQuantLoading(true);
    if (selectedModel?.mode === 'hf') {
      const fileName = file.path.split('/').pop() || file.path;
      const label = fileName.replace(/\.gguf$/i, '').replace(/-\d{5}-of-\d{5}$/, '');
      const updated: ModelSelection = {
        ...selectedModel,
        file: file.path,
        label,
        metadata: file.metadata,
      };
      const metadata = await fetchGgufMetadata(selectedModel.repo, file.path).catch(() => null);
      if (quantCancelledRef.current) return;
      if (metadata) {
        updated.metadata = metadata;
      }
      setSelectedModel(updated);
      setModelSizeBytes(file.sizeBytes);
      setModelMetadata(updated.metadata);
      setChatTemplateOverride(loadTemplateOverride(updated));
      setQuantSelectedContextSize(contextSize);
      goToLayersOrParams(contextSize, file.sizeBytes);
    }
  };

  const goToLayersOrParams = (ctx: number, sizeOverride?: number) => {
    const size = sizeOverride ?? modelSizeBytes;
    if (size && hardware && hardware.vramMb > 0) {
      setDidShowLayerSelect(true);
      setLayerSelectIndex(undefined);
      setScreen('layer-select');
      return;
    }
    setDidShowLayerSelect(false);
    setGpuLayers(99);
    setParamsSelectIndex(undefined);
    setScreen('params-select');
  };

  const handleLayerSelect = (layers: number) => {
    setGpuLayers(layers);
    setParamsSelectIndex(undefined);
    setScreen('params-select');
  };

  const handleQuantBack = () => {
    quantCancelledRef.current = true;
    setQuantLoading(false);
    setScreen('context-select');
  };

  const goBackFromParams = () => {
    if (didShowLayerSelect) {
      setScreen('layer-select');
    } else if (selectedModel?.mode === 'hf' && selectedModel.file) {
      setQuantLoading(false);
      setScreen('quant-picker');
    } else {
      setScreen('context-select');
    }
  };

  const goBackFromLayers = () => {
    if (selectedModel?.mode === 'hf' && selectedModel.file) {
      setQuantLoading(false);
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

  const handleTemplateConfirm = (override: string | undefined) => {
    setChatTemplateOverride(override);
    if (selectedModel) {
      saveTemplateOverride(selectedModel, override);
    }
    setScreen('params-select');
  };

  const handleRouter = () => {
    setScreen('router-config');
  };

  const handleRouterConfirm = (router: RouterLaunchConfig) => {
    const fullSelection: FullSelection = {
      model: {
        mode: 'router',
        label: 'Multi-model router',
        presetPath: router.presetPath,
      },
      contextSize: 0,
      gpuLayers: 0,
      mtpEnabled: false,
      params: null,
      rawArgs: [],
      router,
    };
    onDone({ config, hardware, network, selection: fullSelection });
    exit();
  };

  const finalize = (params: ModelParams | null, rawArgs: string[]) => {
    const metadata = modelSizeBytes ? getEffectiveMetadata(modelMetadata, modelSizeBytes) : modelMetadata;
    const model = { ...selectedModel!, metadata } as ModelSelection;
    const modelSource = model.mode === 'hf'
      ? model.repo
      : model.mode === 'local'
        ? model.path
        : model.label;
    const fullSelection: FullSelection = {
      model,
      metadata,
      contextSize,
      gpuLayers,
      mtpEnabled: detectMtp(
        metadata,
        modelSource,
        model.mode === 'hf' ? model.file : undefined
      ),
      params,
      rawArgs,
      chatTemplateOverride,
    };
    onDone({ config, hardware, network, selection: fullSelection });
    exit();
  };

  const handleQuit = () => {
    process.exit(0);
  };

  const handleSettings = () => {
    setSettingsConfig(loadStoredConfig());
    setShowSettings(true);
  };

  const handleSettingsDone = (saved: boolean, updated?: boolean) => {
    setShowSettings(false);
    setSettingsConfig(null);
    if (saved) {
      setConfigVersion(v => v + 1);
    }
    if (updated) {
      refreshVersion();
    }
  };

  const modelIdentifier = selectedModel ? getModelIdentifier(selectedModel) : '';
  const preset = selectedModel ? findPreset(modelIdentifier) : null;
  const profiles = preset?.profiles || [];
  const effectiveMetadata = modelSizeBytes
    ? getEffectiveMetadata(modelMetadata, modelSizeBytes)
    : modelMetadata;
  const kvCache = modelSizeBytes
    ? calculateKvCache(contextSize, effectiveMetadata, modelSizeBytes)
    : null;

  if (showSettings && settingsConfig) {
    return (
      <SettingsScreen
        currentConfig={settingsConfig}
        onDone={handleSettingsDone}
      />
    );
  }

  return (
    <Box flexDirection="column">
      {screen === 'model-select' && (
        <ModelSelect
          models={models}
          loading={modelsLoading}
          hfCachePath={config.hfCachePath}
          version={version}
          onSelect={handleModelSelect}
          onRouter={handleRouter}
          onDelete={deleteModel}
          onRefresh={refreshModels}
          onQuit={handleQuit}
          onSettings={handleSettings}
          initialSelectedIndex={modelSelectIndex}
          onSelectedIndexChange={setModelSelectIndex}
        />
      )}

      {screen === 'router-config' && (
        <RouterConfig
          models={models}
          config={config}
          hardware={hardware}
          onConfirm={handleRouterConfirm}
          onBack={() => setScreen('model-select')}
        />
      )}

      {screen === 'context-select' && (
        <ContextSelect
          options={config.contextOptions}
          modelSizeBytes={modelSizeBytes}
          metadata={effectiveMetadata}
          hardware={hardware}
          onSelect={handleContextSelect}
          onBack={() => setScreen('model-select')}
          initialSelectedIndex={contextSelectIndex}
          onSelectedIndexChange={setContextSelectIndex}
        />
      )}

      {screen === 'quant-picker' && selectedModel?.mode === 'hf' && (
        <QuantPicker
          repo={selectedModel.repo}
          contextTokens={contextSize}
          hardware={hardware}
          localModels={models}
          selecting={quantLoading}
          onSelect={handleQuantSelect}
          onBack={handleQuantBack}
          initialSelectedIndex={quantPickerIndex}
          onSelectedIndexChange={setQuantPickerIndex}
        />
      )}

      {screen === 'layer-select' && modelSizeBytes && hardware && (
        <LayerSelect
          totalLayers={(effectiveMetadata?.blockCount ?? estimateModelMetadata(modelSizeBytes).blockCount!) + (effectiveMetadata?.nextNPredictLayers ?? 0)}
          modelSizeMb={Math.floor(modelSizeBytes / (1024 * 1024))}
          kvCacheMb={kvCache?.kvCacheMb ?? 0}
          kvCacheEstimated={kvCache?.isEstimated ?? true}
          metadata={effectiveMetadata}
          vramMb={hardware.vramMb}
          ramMb={hardware.ramMb}
          unifiedMemory={hardware.unifiedMemory}
          onSelect={handleLayerSelect}
          onBack={goBackFromLayers}
          initialSelectedIndex={layerSelectIndex}
          onSelectedIndexChange={setLayerSelectIndex}
        />
      )}

      {screen === 'params-select' && (
        <ParamsSelect
          presetName={preset?.name || 'Model'}
          profiles={profiles}
          hasTemplate={!!effectiveMetadata?.chatTemplate}
          hasTemplateOverride={chatTemplateOverride !== undefined}
          onSelect={handleParamsSelect}
          onCustom={() => {
            setCustomParamsIndex(undefined);
            setScreen('custom-params');
          }}
          onExpert={() => setScreen('expert-params')}
          onExpertDirect={handleExpertDirect}
          onTemplate={() => setScreen('chat-template')}
          onBack={goBackFromParams}
          initialSelectedIndex={paramsSelectIndex}
          onSelectedIndexChange={setParamsSelectIndex}
        />
      )}

      {screen === 'custom-params' && (
        <CustomParams
          onConfirm={handleCustomConfirm}
          onBack={() => setScreen('params-select')}
          initialSelectedIndex={customParamsIndex}
          onSelectedIndexChange={setCustomParamsIndex}
        />
      )}

      {screen === 'expert-params' && (
        <ExpertParams
          onConfirm={handleExpertConfirm}
          onBack={() => setScreen('params-select')}
        />
      )}

      {screen === 'chat-template' && (
        <ChatTemplate
          embeddedTemplate={effectiveMetadata?.chatTemplate}
          currentOverride={chatTemplateOverride}
          onConfirm={handleTemplateConfirm}
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

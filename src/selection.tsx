import React, { useState, useMemo } from 'react';
import { Box, render, useApp } from 'ink';
import { statSync } from 'node:fs';
import { loadConfig } from './config.js';
import { useHardware } from './hooks/useHardware.js';
import { useModels } from './hooks/useModels.js';
import { detectMtp } from './services/mtp.js';
import { getProfiles, findPreset } from './services/presets.js';
import { saveToHistory } from './services/params-history.js';
import { normalizeHfRef } from './utils/hf-url.js';
import { ModelSelect } from './screens/ModelSelect.js';
import { ContextSelect } from './screens/ContextSelect.js';
import { QuantPicker } from './screens/QuantPicker.js';
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

function getModelSizeBytes(model: ModelSelection): number | undefined {
  if (model.mode === 'local') {
    try {
      return statSync(model.path).size;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function SelectionApp({ onDone }: SelectionAppProps) {
  const config = useMemo(() => loadConfig(), []);
  const { hardware, network } = useHardware(config.port);
  const { models, loading: modelsLoading, deleteModel } = useModels(config.hfCachePath);
  const { exit } = useApp();

  const [screen, setScreen] = useState<Screen>('model-select');
  const [selectedModel, setSelectedModel] = useState<ModelSelection | null>(null);
  const [contextSize, setContextSize] = useState(config.defaultContext);

  const handleModelSelect = (model: ModelSelection) => {
    if (model.mode === 'hf') {
      const { repo, quant } = normalizeHfRef(model.repo);
      model = { ...model, repo };
      if (quant) {
        model = { ...model, file: quant };
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
      goToParams(selectedModel!, ctx);
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
      goToParams(updated, contextSize);
    }
  };

  const goToParams = (_model: ModelSelection, _ctx: number) => {
    setScreen('params-select');
  };

  const handleParamsSelect = (params: ModelParams | null) => {
    finalize(selectedModel!, contextSize, params, []);
  };

  const handleCustomConfirm = (params: ModelParams) => {
    const hasParams = Object.keys(params).length > 0;
    if (hasParams) {
      saveToHistory({ type: 'custom', params });
    }
    finalize(selectedModel!, contextSize, hasParams ? params : null, []);
  };

  const handleExpertConfirm = (rawArgs: string[]) => {
    if (rawArgs.length > 0) {
      saveToHistory({ type: 'expert', rawArgs, raw: rawArgs.join(' ') });
    }
    finalize(selectedModel!, contextSize, null, rawArgs);
  };

  const handleExpertDirect = (rawArgs: string[]) => {
    finalize(selectedModel!, contextSize, null, rawArgs);
  };

  const finalize = (model: ModelSelection, ctx: number, params: ModelParams | null, rawArgs: string[]) => {
    const fullSelection: FullSelection = {
      model,
      contextSize: ctx,
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
          modelSizeBytes={selectedModel ? getModelSizeBytes(selectedModel) : undefined}
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

      {screen === 'params-select' && (
        <ParamsSelect
          presetName={preset?.name || 'Model'}
          profiles={profiles}
          onSelect={handleParamsSelect}
          onCustom={() => setScreen('custom-params')}
          onExpert={() => setScreen('expert-params')}
          onExpertDirect={handleExpertDirect}
          onBack={() => {
            if (selectedModel?.mode === 'hf' && selectedModel.file) {
              setScreen('quant-picker');
            } else {
              setScreen('context-select');
            }
          }}
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

import React, { useState, useMemo } from 'react';
import { Box, render, useApp } from 'ink';
import { loadConfig } from './config.js';
import { useHardware } from './hooks/useHardware.js';
import { useModels } from './hooks/useModels.js';
import { detectMtp } from './services/mtp.js';
import { normalizeHfRef } from './utils/hf-url.js';
import { ModelSelect } from './screens/ModelSelect.js';
import { ContextSelect } from './screens/ContextSelect.js';
import { QuantPicker } from './screens/QuantPicker.js';
import type { Screen, ModelSelection, FullSelection, HfFile, Config, HardwareInfo, NetworkInfo } from './types.js';

export interface SelectionResult {
  config: Config;
  hardware: HardwareInfo | null;
  network: NetworkInfo | null;
  selection: FullSelection;
}

interface SelectionAppProps {
  onDone: (result: SelectionResult) => void;
}

function SelectionApp({ onDone }: SelectionAppProps) {
  const config = useMemo(() => loadConfig(), []);
  const { hardware, network } = useHardware(config.port);
  const { models, loading: modelsLoading } = useModels(config.hfCachePath);
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
      finalize(selectedModel!, ctx);
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
      finalize(updated, contextSize);
    }
  };

  const finalize = (model: ModelSelection, ctx: number) => {
    const fullSelection: FullSelection = {
      model,
      contextSize: ctx,
      mtpEnabled: detectMtp(
        model.mode === 'hf' ? model.repo : model.path,
        model.mode === 'hf' ? model.file : undefined
      ),
    };
    onDone({ config, hardware, network, selection: fullSelection });
    exit();
  };

  const handleQuit = () => {
    process.exit(0);
  };

  return (
    <Box flexDirection="column">
      {screen === 'model-select' && (
        <ModelSelect
          models={models}
          loading={modelsLoading}
          hfCachePath={config.hfCachePath}
          onSelect={handleModelSelect}
          onQuit={handleQuit}
        />
      )}

      {screen === 'context-select' && (
        <ContextSelect
          options={config.contextOptions}
          defaultContext={config.defaultContext}
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

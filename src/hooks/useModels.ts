import { useState, useEffect, useCallback } from 'react';
import type { LocalModel } from '../types.js';
import { scanLocalModels, deleteLocalModel } from '../services/models.js';

export function useModels(hfCachePath: string) {
  const [models, setModels] = useState<LocalModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanTrigger, setScanTrigger] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function scan() {
      setLoading(true);
      const found = await scanLocalModels(hfCachePath);
      if (!cancelled) {
        setModels(found);
        setLoading(false);
      }
    }

    scan();
    return () => { cancelled = true; };
  }, [hfCachePath, scanTrigger]);

  const deleteModel = useCallback((model: LocalModel) => {
    deleteLocalModel(model.path);
    setScanTrigger(n => n + 1);
  }, []);

  const refreshModels = useCallback(() => {
    setScanTrigger(n => n + 1);
  }, []);

  return { models, loading, deleteModel, refreshModels };
}

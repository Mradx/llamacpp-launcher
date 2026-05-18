import { useState, useEffect } from 'react';
import type { LocalModel } from '../types.js';
import { scanLocalModels } from '../services/models.js';

export function useModels(hfCachePath: string) {
  const [models, setModels] = useState<LocalModel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function scan() {
      const found = await scanLocalModels(hfCachePath);
      if (!cancelled) {
        setModels(found);
        setLoading(false);
      }
    }

    scan();
    return () => { cancelled = true; };
  }, [hfCachePath]);

  return { models, loading };
}

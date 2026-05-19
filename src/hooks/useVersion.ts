import { useState, useEffect, useCallback } from 'react';
import {
  getLocalVersion,
  getLatestRelease,
  computeBuildsBehind,
  type LocalVersion,
  type RemoteVersion,
  type VersionInfo,
} from '../services/llamacpp-version.js';

export function useVersion(llamaCppDir: string) {
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const local = getLocalVersion(llamaCppDir);
    if (!local) {
      setLoading(false);
      return;
    }

    setVersion({ local, remote: null, buildsBehind: null });
    setLoading(false);

    getLatestRelease().then((remote) => {
      if (cancelled || !remote) return;
      const buildsBehind = computeBuildsBehind(local, remote);
      setVersion({ local, remote, buildsBehind });
    });

    return () => { cancelled = true; };
  }, [llamaCppDir, refreshKey]);

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  return { version, loading, refresh };
}

import { useState, useEffect } from 'react';
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

  useEffect(() => {
    let cancelled = false;

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
  }, [llamaCppDir]);

  return { version, loading };
}

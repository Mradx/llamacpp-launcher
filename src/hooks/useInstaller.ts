import { useState, useEffect, useCallback } from 'react';
import {
  detectPrerequisites,
  getCriticalMissing,
  canAutoInstall,
  runFullInstall,
  pullAndRebuild,
  autoInstallPrereq,
  type PrerequisiteStatus,
  type InstallProgress,
  type AutoInstallName,
} from '../services/installer.js';

export function useInstaller() {
  const [prereqs, setPrereqs] = useState<PrerequisiteStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [sourceChanged, setSourceChanged] = useState(false);

  const detect = useCallback(() => {
    setChecking(true);
    try {
      const result = detectPrerequisites();
      setPrereqs(result);
    } catch {
      // detection itself shouldn't fail, but just in case
    }
    setChecking(false);
  }, []);

  useEffect(() => { detect(); }, [detect]);

  const startInstall = useCallback(async (targetDir: string) => {
    if (!prereqs) return;
    setInstalling(true);
    setError(null);
    setProgress(null);
    setCompleted(false);
    try {
      await runFullInstall(targetDir, prereqs, setProgress);
      setSourceChanged(true);
      setCompleted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  }, [prereqs]);

  const startUpdate = useCallback(async (llamaCppDir: string) => {
    if (!prereqs) return;
    setInstalling(true);
    setError(null);
    setProgress(null);
    setCompleted(false);
    try {
      await pullAndRebuild(llamaCppDir, prereqs, setProgress);
      setSourceChanged(true);
      setCompleted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  }, [prereqs]);

  const installPrereq = useCallback(async (name: AutoInstallName): Promise<{ ok: boolean; error?: string }> => {
    try {
      const result = await autoInstallPrereq(name, setProgress);
      if (result.ok) detect();
      return result;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [detect]);

  const installAllMissing = useCallback(async (
    onStart: (name: string) => void,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      while (true) {
        const current = detectPrerequisites();
        setPrereqs(current);

        const missing = getCriticalMissing(current);
        const next = missing.find(m => canAutoInstall(m));
        if (!next) break;

        onStart(next);

        const result = await autoInstallPrereq(
          next as AutoInstallName,
          setProgress,
        );
        if (!result.ok) {
          return { ok: false, error: result.error || `Failed to install ${next}` };
        }
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  return {
    prereqs,
    checking,
    installing,
    progress,
    error,
    completed,
    sourceChanged,
    startInstall,
    startUpdate,
    installPrereq,
    installAllMissing,
    redetect: detect,
  };
}

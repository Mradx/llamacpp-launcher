import { useState, useEffect, useCallback } from 'react';
import {
  detectPrerequisites,
  runFullInstall,
  pullAndRebuild,
  autoInstallPrereq,
  type PrerequisiteStatus,
  type InstallProgress,
} from '../services/installer.js';

export function useInstaller() {
  const [prereqs, setPrereqs] = useState<PrerequisiteStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

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
    setCompleted(false);
    try {
      await runFullInstall(targetDir, prereqs, setProgress);
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
    setCompleted(false);
    try {
      await pullAndRebuild(llamaCppDir, prereqs, setProgress);
      setCompleted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  }, [prereqs]);

  const installPrereq = useCallback(async (name: 'Git' | 'NVM') => {
    try {
      const ok = await autoInstallPrereq(name, setProgress);
      if (ok) detect();
      return ok;
    } catch {
      return false;
    }
  }, [detect]);

  return {
    prereqs,
    checking,
    installing,
    progress,
    error,
    completed,
    startInstall,
    startUpdate,
    installPrereq,
    redetect: detect,
  };
}

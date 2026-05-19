import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, '..');

function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

export function getPackageResourcePath(fileName: string): string {
  return resolve(packageRoot, fileName);
}

export function getDataRoot(): string {
  const explicit = process.env.LLAMACPP_LAUNCHER_HOME?.trim();
  if (explicit) return resolve(explicit);

  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return resolve(process.env.LOCALAPPDATA, 'llamacpp-launcher');
  }

  return resolve(homedir(), '.llamacpp-launcher');
}

function migrateLegacyFile(fileName: string, targetPath: string): void {
  if (existsSync(targetPath)) return;

  const candidates = [
    resolve(packageRoot, fileName),
    resolve(process.cwd(), fileName),
  ];

  for (const candidate of candidates) {
    if (samePath(candidate, targetPath) || !existsSync(candidate)) continue;
    try {
      copyFileSync(candidate, targetPath);
      return;
    } catch {
      // Keep startup resilient if legacy files are locked or unreadable.
    }
  }
}

export function getDataPath(fileName: string): string {
  const root = getDataRoot();
  mkdirSync(root, { recursive: true });

  const targetPath = resolve(root, fileName);
  migrateLegacyFile(fileName, targetPath);
  return targetPath;
}

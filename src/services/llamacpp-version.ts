import { execSync } from 'node:child_process';

export interface LocalVersion {
  tag: string | null;
  commit: string;
  commitDate: string;
}

export interface RemoteVersion {
  tag: string;
  publishedAt: string;
}

export interface VersionInfo {
  local: LocalVersion;
  remote: RemoteVersion | null;
  buildsBehind: number | null;
}

function git(cmd: string, cwd: string): string | null {
  try {
    return execSync(`git ${cmd}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function parseBuildNumber(tag: string): number | null {
  const m = tag.match(/^b(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

export function getLocalVersion(llamaCppDir: string): LocalVersion | null {
  const commit = git('rev-parse --short HEAD', llamaCppDir);
  if (!commit) return null;

  const tag = git('describe --tags --abbrev=0', llamaCppDir);
  const commitDate = git('log -1 --format=%ci', llamaCppDir);

  return {
    tag,
    commit,
    commitDate: commitDate || '',
  };
}

export async function getLatestRelease(): Promise<RemoteVersion | null> {
  try {
    const resp = await fetch(
      'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest',
      {
        headers: { 'Accept': 'application/vnd.github+json' },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!resp.ok) return null;
    const data = await resp.json() as { tag_name: string; published_at: string };
    return {
      tag: data.tag_name,
      publishedAt: data.published_at,
    };
  } catch {
    return null;
  }
}

export function computeBuildsBehind(
  local: LocalVersion,
  remote: RemoteVersion,
): number | null {
  const localNum = local.tag ? parseBuildNumber(local.tag) : null;
  const remoteNum = parseBuildNumber(remote.tag);
  if (localNum == null || remoteNum == null) return null;
  return Math.max(0, remoteNum - localNum);
}

export function formatAge(commitDate: string): string {
  if (!commitDate) return '';
  const commit = new Date(commitDate);
  const now = new Date();
  const diffMs = now.getTime() - commit.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks <= 8) return `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  return `${months} months ago`;
}

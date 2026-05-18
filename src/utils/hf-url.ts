export function normalizeHfRef(input: string): { repo: string; quant?: string } {
  let cleaned = input.trim();

  cleaned = cleaned.replace(/^https?:\/\//, '');
  cleaned = cleaned.replace(/^(www\.)?huggingface\.co\//, '');
  cleaned = cleaned.replace(/\/+$/, '');

  let quant: string | undefined;
  if (cleaned.includes(':')) {
    const [repoPart, quantPart] = cleaned.split(':');
    cleaned = repoPart;
    quant = quantPart;
  }

  const segments = cleaned.split('/').filter(Boolean);
  if (segments.length >= 2) {
    const repo = `${segments[0]}/${segments[1]}`;
    return { repo, quant };
  }

  return { repo: cleaned, quant };
}

export function deriveModelLabel(model: { mode: string; repo?: string; file?: string; path?: string }): string {
  if (model.mode === 'local' && model.path) {
    const parts = model.path.split(/[/\\]/);
    return parts[parts.length - 1]?.replace('.gguf', '') || 'Unknown';
  }

  if (model.file) {
    return model.file.replace('.gguf', '');
  }

  if (model.repo) {
    const parts = model.repo.split('/');
    return parts[parts.length - 1] || model.repo;
  }

  return 'Unknown Model';
}

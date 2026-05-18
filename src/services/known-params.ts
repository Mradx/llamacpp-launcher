export const KNOWN_SAMPLING_ARGS = new Set([
  '--temp', '--temperature',
  '--top-k',
  '--top-p',
  '--min-p',
  '--top-nsigma', '--top-n-sigma',
  '--xtc-probability',
  '--xtc-threshold',
  '--typical', '--typical-p',
  '--repeat-last-n',
  '--repeat-penalty',
  '--presence-penalty',
  '--frequency-penalty',
  '--dry-multiplier',
  '--dry-base',
  '--dry-allowed-length',
  '--dry-penalty-last-n',
  '--dry-sequence-breaker',
  '--adaptive-target',
  '--adaptive-decay',
  '--dynatemp-range',
  '--dynatemp-exp',
  '--mirostat',
  '--mirostat-lr',
  '--mirostat-ent',
  '--logit-bias', '-l',
  '--grammar',
  '--grammar-file',
  '--json-schema', '-j',
  '--json-schema-file', '-jf',
  '--seed', '-s',
  '--samplers',
  '--sampler-seq', '--sampling-seq',
  '--ignore-eos',
  '--backend-sampling', '-bs',
]);

export function isKnownArg(arg: string): boolean {
  return KNOWN_SAMPLING_ARGS.has(arg);
}

export function parseRawArgs(input: string): string[] {
  const args: string[] = [];
  const regex = /(?:[^\s"]+|"[^"]*")+/g;
  let match;
  while ((match = regex.exec(input)) !== null) {
    args.push(match[0].replace(/^"|"$/g, ''));
  }
  return args;
}

export function findUnknownArgs(args: string[]): string[] {
  const unknown: string[] = [];
  for (const arg of args) {
    if (arg.startsWith('-') && !isKnownArg(arg)) {
      unknown.push(arg);
    }
  }
  return unknown;
}

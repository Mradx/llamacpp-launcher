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

function findLineContinuationEnd(input: string, start: number): number {
  let index = start;
  while (input[index] === ' ' || input[index] === '\t') {
    index++;
  }
  if (input[index] === '\n' || index >= input.length) {
    return index;
  }
  return -1;
}

function skipHorizontalWhitespace(input: string, start: number): number {
  let index = start;
  while (input[index] === ' ' || input[index] === '\t') {
    index++;
  }
  return index;
}

function appendSpaceOnce(output: string): string {
  if (output.length === 0 || /\s$/.test(output)) {
    return output;
  }
  return `${output} `;
}

export function normalizeRawArgsInput(input: string): string {
  const source = input.replace(/\r\n?/g, '\n');
  let output = '';
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];

    if (quote) {
      output += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      output += char;
      continue;
    }

    if (char === '\\' || char === '`') {
      const continuationEnd = findLineContinuationEnd(source, index + 1);
      if (continuationEnd !== -1) {
        output = appendSpaceOnce(output);
        index = source[continuationEnd] === '\n'
          ? skipHorizontalWhitespace(source, continuationEnd + 1) - 1
          : continuationEnd;
        continue;
      }
    }

    if (char === '\n') {
      output = appendSpaceOnce(output);
      index = skipHorizontalWhitespace(source, index + 1) - 1;
      continue;
    }

    output += char;
  }

  return output.trim();
}

export function parseRawArgs(input: string): string[] {
  const normalized = normalizeRawArgsInput(input);
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let tokenStarted = false;

  const pushCurrent = () => {
    if (tokenStarted) {
      args.push(current);
      current = '';
      tokenStarted = false;
    }
  };

  for (const char of normalized) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char)) {
      pushCurrent();
      continue;
    }

    current += char;
    tokenStarted = true;
  }

  pushCurrent();
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

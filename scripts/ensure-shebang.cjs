const { readFileSync, writeFileSync } = require('node:fs');

const entry = 'dist/index.js';
const source = readFileSync(entry, 'utf8');

if (!source.startsWith('#!')) {
  writeFileSync(entry, `#!/usr/bin/env node\n${source}`);
}

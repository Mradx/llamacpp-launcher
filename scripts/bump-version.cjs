const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const root = process.cwd();
const packagePath = join(root, 'package.json');
const lockPath = join(root, 'package-lock.json');
const packMarkerPath = join(root, '.npm-pack-version.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const pkg = readJson(packagePath);
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version);

if (!match) {
  throw new Error(`Cannot bump non-standard package version: ${pkg.version}`);
}

const previous = pkg.version;
const next = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;

pkg.version = next;
writeJson(packagePath, pkg);

if (existsSync(lockPath)) {
  const lock = readJson(lockPath);
  lock.version = next;

  if (lock.packages?.['']) {
    lock.packages[''].version = next;
  }

  writeJson(lockPath, lock);
}

if (process.env.npm_lifecycle_event === 'prepack') {
  writeJson(packMarkerPath, {
    name: pkg.name,
    previous,
    next,
  });
}

console.log(`Version bumped: ${previous} -> ${next}`);

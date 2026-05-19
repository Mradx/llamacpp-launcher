const { existsSync, readFileSync, renameSync, unlinkSync } = require('node:fs');
const { join } = require('node:path');

const root = process.cwd();
const markerPath = join(root, '.npm-pack-version.json');

if (!existsSync(markerPath)) {
  process.exit(0);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function tarballName(packageName, version) {
  return `${packageName.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`;
}

const marker = readJson(markerPath);
const from = join(root, tarballName(marker.name, marker.previous));
const to = join(root, tarballName(marker.name, marker.next));

try {
  if (existsSync(from) && from !== to) {
    if (existsSync(to)) {
      unlinkSync(to);
    }
    renameSync(from, to);
    console.log(`Renamed packed tarball: ${tarballName(marker.name, marker.previous)} -> ${tarballName(marker.name, marker.next)}`);
  }
} finally {
  unlinkSync(markerPath);
}

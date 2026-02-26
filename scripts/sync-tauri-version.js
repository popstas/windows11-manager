#!/usr/bin/env node
/**
 * Syncs version from root package.json to tauri-app package.json,
 * tauri.conf.json, Cargo.toml, and .release-please-manifest.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const v = pkg.version;

const files = [
  ['tauri-app/package.json', (c) => { const j = JSON.parse(c); j.version = v; return JSON.stringify(j, null, 2) + '\n'; }],
  ['tauri-app/src-tauri/tauri.conf.json', (c) => { const j = JSON.parse(c); j.version = v; return JSON.stringify(j, null, 2) + '\n'; }],
  ['tauri-app/src-tauri/Cargo.toml', (c) => c.replace(/^version = ".*"/m, `version = "${v}"`)],
  ['tauri-app/src-tauri/Cargo.lock', (c) => c.replace(/^version = ".*"/m, `version = "${v}"`)],
  ['.release-please-manifest.json', (c) => { const j = JSON.parse(c); j['.'] = v; return JSON.stringify(j) + '\n'; }],
];

for (const [rel, updater] of files) {
  const p = path.join(rootDir, rel);
  const content = fs.readFileSync(p, 'utf8');
  const next = updater(content);
  if (content !== next) {
    fs.writeFileSync(p, next);
    console.log(`Updated ${rel} to ${v}`);
  }
}

#!/usr/bin/env node
/**
 * Syncs version from root package.json to tauri-app package.json,
 * tauri.conf.json, Cargo.toml, Cargo.lock and the plugin manifests.
 *
 * Правится всё это на `npm version`: скрипт висит на одноимённом lifecycle,
 * то есть бежит после бампа и до коммита, и версия сходится везде одним
 * коммитом. Пока версии вёл release-please, здесь стоял ещё и его манифест —
 * ушёл вместе с ним.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const v = pkg.version;

export { setLockVersion, setManifestVersion, PLUGIN_MANIFESTS };

/**
 * Манифесты плагина для Claude Code и Codex. Версия в них — та же, что у
 * пакета: плагин ставится из этого же репозитория и своих релизов не имеет.
 */
const PLUGIN_MANIFESTS = [
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  '.codex-plugin/plugin.json',
];

function setLockVersion(lock, name, version) {
  const re = new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = ")[^"]*(")`);
  return lock.replace(re, `$1${version}$2`);
}

/** Версия манифеста плагина: верхняя, а у marketplace — ещё metadata и plugins[]. */
function setManifestVersion(text, version) {
  const j = JSON.parse(text);
  if ('version' in j) j.version = version;
  if (j.metadata) j.metadata.version = version;
  for (const plugin of j.plugins || []) plugin.version = version;
  return JSON.stringify(j, null, 2) + '\n';
}

const files = [
  ['tauri-app/package.json', (c) => { const j = JSON.parse(c); j.version = v; return JSON.stringify(j, null, 2) + '\n'; }],
  ['tauri-app/src-tauri/tauri.conf.json', (c) => { const j = JSON.parse(c); j.version = v; return JSON.stringify(j, null, 2) + '\n'; }],
  ['tauri-app/src-tauri/Cargo.toml', (c) => c.replace(/^version = ".*"/m, `version = "${v}"`)],
  // В Cargo.lock правится версия своего пакета, а не первая попавшаяся: файл
  // отсортирован по именам, и первой в нём стоит чужая зависимость. Голый
  // `/^version = /m` годами переписывал её (`adler2`), а свой пакет оставлял
  // на прошлой версии — cargo после этого шёл в сеть за несуществующей версией.
  ['tauri-app/src-tauri/Cargo.lock', (c) => setLockVersion(c, 'windows11-manager-tray', v)],
  ...PLUGIN_MANIFESTS.map((rel) => [rel, (c) => setManifestVersion(c, v)]),
];

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
for (const [rel, updater] of isMain ? files : []) {
  const p = path.join(rootDir, rel);
  const content = fs.readFileSync(p, 'utf8');
  const next = updater(content);
  if (content !== next) {
    fs.writeFileSync(p, next);
    console.log(`Updated ${rel} to ${v}`);
  }
}

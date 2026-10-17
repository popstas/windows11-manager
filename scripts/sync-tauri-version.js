#!/usr/bin/env node
/**
 * Syncs version from root package.json to tauri-app package.json,
 * tauri.conf.json, Cargo.toml and Cargo.lock.
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

const files = [
  ['tauri-app/package.json', (c) => { const j = JSON.parse(c); j.version = v; return JSON.stringify(j, null, 2) + '\n'; }],
  ['tauri-app/src-tauri/tauri.conf.json', (c) => { const j = JSON.parse(c); j.version = v; return JSON.stringify(j, null, 2) + '\n'; }],
  ['tauri-app/src-tauri/Cargo.toml', (c) => c.replace(/^version = ".*"/m, `version = "${v}"`)],
  // В Cargo.lock версия ищется в секции самого трея, а не первой строкой
  // `version = "…"` файла: первой там стоит чужой крейт (`adler2`), и релиз
  // 4.3.0 вписал версию ему, оставив трею прежнюю. Файл тогда переписывает
  // первая же сборка на каждой машине, он остаётся грязным, и выкатка другой
  // ветки спотыкается о `git checkout`.
  ['tauri-app/src-tauri/Cargo.lock', (c) => c.replace(
    /(\nname = "windows11-manager-tray"\r?\nversion = )".*"/,
    `$1"${v}"`,
  )],
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

#!/usr/bin/env node
/**
 * Приводит заголовок GitHub-релиза к виду `vX.Y.Z: <главная фича>`.
 *
 * Главная фича — первый заголовок тела релиза: тела здесь пишутся руками и
 * начинаются с `## Раскладки окон для терминалов Claude`. Пока тело —
 * автогенерация release-please (`## [4.1.0](compare…) (2026-08-18)`), фичи в
 * нём нет, и заголовком остаётся просто `vX.Y.Z`.
 *
 *   node scripts/release-title.js              # последний релиз
 *   node scripts/release-title.js <tag>...     # названные релизы
 *   node scripts/release-title.js --all        # все релизы
 *   node scripts/release-title.js --all --dry-run
 */
import { execFileSync } from 'node:child_process';

/** `windows11-manager-v4.1.0` и `v4.1.0` → `4.1.0`. */
export function versionFromTag(tag) {
  const m = /(?:^|-)v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(String(tag ?? ''));
  return m ? m[1] : null;
}

/** `[текст](url)` → `текст`, `**жирный**` → `жирный`, хвостовая ссылка на PR — прочь. */
function stripMarkdown(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_)(.+?)\1/g, '$2')
    .replace(/\s*\(#\d+\)\s*$/, '')
    .trim();
}

/**
 * Секции автогенерённого changelog: у старых релизов тело начинается прямо с
 * `### Bug Fixes`, без строки с версией. Это не фича, это рубрика.
 */
const CHANGELOG_SECTIONS = new Set([
  'features',
  'bug fixes',
  'performance improvements',
  'documentation',
  'miscellaneous chores',
  'code refactoring',
  'tests',
  'build system',
  'continuous integration',
  'reverts',
  'styles',
  'dependencies',
  'breaking changes',
]);

/**
 * Первый заголовок тела релиза или null, если тело — автогенерация
 * release-please: её заголовки — либо номер версии, либо рубрика changelog.
 */
export function featureFromBody(body) {
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const m = /^#{1,6}\s+(.*\S)\s*$/.exec(line);
    if (!m) continue;
    if (/^\[?\d+\.\d+\.\d+/.test(m[1])) return null;
    const text = stripMarkdown(m[1]);
    if (CHANGELOG_SECTIONS.has(text.toLowerCase())) return null;
    return text || null;
  }
  return null;
}

/** Итоговый заголовок релиза либо null, если из тега не вытащить версию. */
export function releaseTitle(tag, body) {
  const version = versionFromTag(tag);
  if (!version) return null;
  const feature = featureFromBody(body);
  return feature ? `v${version}: ${feature}` : `v${version}`;
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const all = argv.includes('--all');
  const tags = argv.filter((a) => !a.startsWith('-'));

  let targets = tags;
  if (all) {
    targets = JSON.parse(gh(['release', 'list', '--limit', '200', '--json', 'tagName']))
      .map((r) => r.tagName);
  } else if (targets.length === 0) {
    targets = [JSON.parse(gh(['release', 'view', '--json', 'tagName'])).tagName];
  }

  let failed = false;
  for (const tag of targets) {
    const release = JSON.parse(gh(['release', 'view', tag, '--json', 'name,body']));
    const next = releaseTitle(tag, release.body);
    if (!next) {
      console.error(`${tag}: не разобрать версию из тега, пропуск`);
      failed = true;
      continue;
    }
    if (next === release.name) {
      console.log(`${tag}: заголовок уже «${next}»`);
      continue;
    }
    console.log(`${tag}: «${release.name}» → «${next}»${dryRun ? ' (dry-run)' : ''}`);
    if (!dryRun) gh(['release', 'edit', tag, '--title', next]);
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}

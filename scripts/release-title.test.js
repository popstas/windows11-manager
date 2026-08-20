import { describe, it, expect } from 'vitest';
import { versionFromTag, featureFromBody, releaseTitle } from './release-title.js';

describe('versionFromTag', () => {
  it('снимает префикс компонента', () => {
    expect(versionFromTag('windows11-manager-v4.1.0')).toBe('4.1.0');
  });

  it('понимает голый тег', () => {
    expect(versionFromTag('v1.0.7')).toBe('1.0.7');
  });

  it('не выдумывает версию из чужого тега', () => {
    expect(versionFromTag('nightly')).toBe(null);
  });
});

describe('featureFromBody', () => {
  it('берёт первый заголовок рукописного тела', () => {
    const body = '## Раскладки окон для терминалов Claude\n\nТекст\n\n### Как позвать\n';
    expect(featureFromBody(body)).toBe('Раскладки окон для терминалов Claude');
  });

  it('разворачивает ссылки и убирает хвостовой номер PR', () => {
    const body = '## Claude sessions restore ([#13](https://github.com/x/y/pull/13))\n';
    expect(featureFromBody(body)).toBe('Claude sessions restore');
  });

  it('снимает выделение', () => {
    expect(featureFromBody('## Конфиг теперь **YAML**')).toBe('Конфиг теперь YAML');
  });

  it('не принимает автогенерацию release-please за фичу', () => {
    const body = '## [3.0.0](https://github.com/x/y/compare/a...b) (2026-08-15)\n\n\n### Features\n\n* что-то\n';
    expect(featureFromBody(body)).toBe(null);
  });

  it('не принимает автогенерацию git-cliff за фичу', () => {
    // Генератор сменился вместе с уходом release-please, и шапка у него другая:
    // не `## [4.1.0](compare…)`, а `## v4.2.0- дата`. Не узнай её проверка —
    // заголовком релиза стало бы `v4.2.0: v4.2.0 - 2026-08-20`, и увидеть это
    // можно было бы только на уже выпущенном релизе.
    const body = '## v4.2.0 - 2026-08-20\n\n### Features\n\n- claude-wt: Слушает курсор\n';
    expect(featureFromBody(body)).toBe(null);
  });

  it('не принимает шапку с префиксом компонента за фичу', () => {
    // `workflow_dispatch` на старом теге: cliff печатает версией имя тега целиком.
    expect(featureFromBody('## windows11-manager-v4.1.0 - 2026-08-18\n')).toBe(null);
  });

  it('не принимает рубрики git-cliff за фичу', () => {
    // Свои имена групп у него тоже другие — `Refactor` вместо `Code Refactoring`.
    expect(featureFromBody('### Refactor\n\n- Постановка окна по курсору\n')).toBe(null);
    expect(featureFromBody('### Miscellaneous\n')).toBe(null);
  });

  it('не принимает рубрику changelog за фичу', () => {
    const body = '### Bug Fixes\n\n* **tauri:** fix tray icon click ([48d3ac8](url))\n';
    expect(featureFromBody(body)).toBe(null);
  });

  it('переживает пустое тело', () => {
    expect(featureFromBody('')).toBe(null);
    expect(featureFromBody(null)).toBe(null);
  });
});

describe('releaseTitle', () => {
  it('склеивает версию с фичей', () => {
    expect(releaseTitle('windows11-manager-v4.1.0', '## Раскладки окон')).toBe('v4.1.0: Раскладки окон');
  });

  it('оставляет одну версию, когда тело автогенерённое', () => {
    expect(releaseTitle('windows11-manager-v3.0.0', '## [3.0.0](url) (2026-08-15)')).toBe('v3.0.0');
  });

  it('возвращает null для тега без версии', () => {
    expect(releaseTitle('latest', '## Что-то')).toBe(null);
  });
});

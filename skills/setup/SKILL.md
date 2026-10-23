---
name: setup
description: Поставить windows11-manager на машину с Windows 11 — node-часть, конфиг и трей — и проверить, что всё поднялось. Запускается вручную — /windows11-manager:setup.
---

# Установка windows11-manager

Связка ставится из одного клона: node-часть (`src/`) делает работу, трей
(`tauri-app/`) запускает её процессами и держит их живыми. Трей node-часть не
содержит — он ходит в каталог клона, поэтому клон остаётся на машине и после
установки.

Работает только на Windows 11. Шаги выполняются на целевой машине; если агент
сидит на другой — те же команды через ssh.

## Что должно быть на машине

- Node.js и git.
- [PowerToys](https://github.com/microsoft/PowerToys) с включённым FancyZones —
  без него работают только правила с явными `x`/`y`/`width`/`height`.
- Rust и C++ build tools (Visual Studio, набор «C++ build tools») — только если
  трей собирается из исходников, а не ставится релизным установщиком.

`VirtualDesktop11.exe` лежит в корне репозитория, ставить его отдельно не нужно.

## Шаги

1. **Клон и зависимости.**

   ```bash
   git clone https://github.com/popstas/windows11-manager
   cd windows11-manager
   npm install
   ```

2. **Проверить нативный аддон.** `node-window-manager` — вендорный аддон в
   `optionalDependencies`, и его сборку npm роняет молча: код выхода нулевой, в
   выводе ни слова, а node потом падает на импорте.

   ```bash
   node -e "import('node-window-manager').then(()=>console.log('ADDON_OK'))"
   ```

   Не `ADDON_OK` — `npm install --include=optional` и смотреть уже на его
   ошибку: обычно не хватает C++ build tools.

3. **Конфиг.** Спросить у человека, где он его держит; по умолчанию —
   `%APPDATA%\windows11-manager\config.yaml`. Скопировать туда
   `config.example.yaml`. Расширение только `.yaml`. Порядок поиска — в README,
   раздел Config; первый найденный файл выигрывает, остальные не читаются.

   Образец — чужая машина: правила `windows`, пути и блок `mqtt` в нём не
   подойдут. Не угадывать — спросить, какие окна куда ставить, и оставить
   только названное. Ненужные блоки (`mqtt`, `homeassistant`, `streamdock`,
   `claudeWt`) убрать целиком, а не оставлять с чужими значениями.

   Проверить, какой файл читается и во что он разобрался:

   ```bash
   node src/index.js config-dump
   ```

4. **Первая расстановка** — проверка node-части без трея:

   ```bash
   node src/index.js place
   ```

   Координаты мимо зон — устаревший DPI в `editor-parameters.json` у
   FancyZones, лечится перезагрузкой.

5. **Трей.** Либо установщик из
   [релизов](https://github.com/popstas/windows11-manager/releases), либо
   сборка:

   ```bash
   cd tauri-app && npm install && cd ..
   cargo build --release --manifest-path tauri-app/src-tauri/Cargo.toml
   ```

   Бинарь — `tauri-app/src-tauri/target/release/windows11-manager-tray.exe`.
   Запускать его нужно в сессии рабочего стола: из ssh-сессии процесс попадёт в
   session 0, где трея нет, — процесс будет, на экране пусто.

6. **Настройки трея** (Settings → General): `Project path` — каталог клона из
   шага 1. Умолчание `c:/projects/js/windows11-manager` почти никогда не
   совпадает, а без верного пути ни один пункт меню не работает. Там же —
   автозапуск.

7. **Проверка.** Первый пункт меню трея — версия и время: позднее из сборки
   трея и последнего `git pull` в клоне. После обновления по нему видно, что
   перезапустилось именно новое. «Place Windows» из трея должен дать то же, что
   шаг 4; отказ ищется в Settings → Log.

## claude-wt

Память позиций окон Windows Terminal по сессиям Claude Code — необязательная
часть. Включается блоком `claudeWt` в конфиге; `statePath` обязателен, без него
демон откажется стартовать. Что из этого зависит от
[ccfzf](https://github.com/popstas/ccfzf) и что работает без него — README,
раздел «Claude Windows Terminals sessions restore».

Проекты со своим профилем терминала добавляет скилл `project-add`.

## Границы

Скилл ставит одну машину. Соседние части связки — пикер
[ccfzf-picker](https://github.com/popstas/ccfzf-picker), агрегатор `ccfzf`, хуки
агента — живут в своих репозиториях и ставятся оттуда.

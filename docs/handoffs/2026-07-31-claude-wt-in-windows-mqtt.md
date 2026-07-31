# Handoff: подключить claude-wt в windows-mqtt

Задача: `windows-mqtt` (`D:\projects\js\windows-mqtt`) должен запускать вотчер
claude-wt при старте и иметь пункт трея **«Restore claude terminals»**.

Автоплейсер подключён почти так же, и это лучший образец — но **не полностью**:
у него нет пункта трея, который что-то запускает, а у claude-wt их два разных
(тумблер-фон и разовая команда). Ниже разведены оба случая.

Ссылки вида `windows.js:10` — на файлы `windows-mqtt`, если не сказано иное.

## Что уже работает без единой строки кода

`windows-mqtt` тянет соседний проект как файловую зависимость
(`package.json:40-42`, `node_modules/windows11-manager` — junction на
`D:\projects\js\windows11-manager`) и делает `require('windows11-manager')`
(`src/modules/windows.js:1`). Точка входа — `src/lib/index.js`, а она уже
реэкспортирует claude-wt целиком:

```js
export * from '../claude-wt/index.js';
export * from '../claude-wt/restore.js';
```

Значит на объекте `winMan` **уже** лежат `startClaudeWt`, `stopClaudeWt`,
`claudeWtStatus`, `getClaudeWtConfig`, `restoreClaudeSessions`,
`maybeRestoreOnStart`. Ничего подключать, спавнить или проксировать не нужно —
только вызвать. Сборщик тоже готов: `scripts/deps-bundle.js:29` копирует весь
`src`, включая `src/claude-wt/`.

## Предусловие: блок claudeWt в конфиге windows11-manager

Это **не** `config.yml` от windows-mqtt. У windows11-manager свой конфиг, и
первый кандидат в его поиске лежит внутри настроек windows-mqtt
(`windows11-manager/src/config.js:22-34`):

```
%APPDATA%\windows-mqtt\windows11-manager.config.js
```

Там должен быть блок `claudeWt` — образец в
`windows11-manager/config.example.cjs`. Обязателен `statePath`: без него
`startClaudeWt()` печатает причину и не стартует, это осознанная защита от
молчаливого запуска без места для состояния. На рабочей машине блок уже
добавлен.

## Задача 1: вотчер на старте

Вотчер — это `setInterval` внутри того же процесса Node, ровно как автоплейсер;
отдельный процесс не нужен. Запускать там же, где стартует автоплейсер, в
`src/modules/windows.js:10-29`:

```js
if (config.placeWindowOnOpen) { await winMan.placeWindowOnOpen(); }
if (config.claudeWt) { winMan.startClaudeWt(); }        // <-- добавить
```

`startClaudeWt()` синхронная, ничего не ждёт и не бросает: при выключенном
`claudeWt.enabled` или пустом `statePath` она пишет причину и возвращается.
Внутри она же проверяет признак аварийной перезагрузки и **только пишет о нём в
лог**, пока в конфиге не выставлен `claudeWt.restore.auto` — поднимать десяток
ssh-сессий на загрузке молча нельзя.

Остановка — в `onStop` (`windows.js:31-40`):

```js
winMan.stopClaudeWt();
```

Здесь стоит заодно исправить давнюю недоделку рядом: `onStop` не зовёт
`winMan.stopPlaceNewWindows()`, хотя тот экспортирован, — интервал автоплейсера
живёт до выхода процесса. Для claude-wt так делать не надо: он раз в секунду
читает окна и пишет файл состояния.

Новый ключ конфига — в `modules.windows` (`config.example.yml:206-227`, рядом с
`placeWindowOnOpen`):

```yaml
  windows:
    placeWindowOnOpen: true
    claudeWt: true            # start the claude-wt window position watcher
```

Модуль без записи в `config.yml` не грузится вовсе (`src/helpers.js:88-98`), так
что ключ нужен и в реальном `config.yml`, не только в примере.

## Задача 2: пункт трея «Restore claude terminals»

Трей — Tauri v2 на Rust. Правки нужны **в двух языках**: объявление и обработчик
в Rust, исполнение в JS. Единого места для «добавить команду» в проекте нет.

Осторожно: в `src/modules/windows.js:187-259` лежит массив `menuItems` — мёртвый
код с электроновских времён, его никто не читает. Пункт, добавленный туда,
молча не сработает.

### Rust: объявление

Рядом с `let autoplace = MenuItem::with_id(...)` (`src-tauri/src/main.rs:577-584`):

```rust
let claude_restore = MenuItem::with_id(
    app, "win_claude_restore", "Restore claude terminals", true, None::<&str>)?;
```

и добавить `&claude_restore` в список элементов там же, где добавляется
`&autoplace` (`main.rs:595`).

### Rust: обработчик

В таблицу id → action в `on_menu_event` (`main.rs:868-893`):

```rust
"win_claude_restore" => Some("windows/claude-restore"),
```

Дальше всё уже есть: `send_command` (`main.rs:73-94`) пишет строку
`{"type":"action","action":"windows/claude-restore"}` в stdin процесса Node,
`src/stdin-handler.js:12-31` находит обработчик в карте, зарегистрированной из
`src/server.js:99-103`.

### JS: исполнение

В `stdinActions` (`src/modules/windows.js:261-278`):

```js
'windows/claude-restore': async () => {
  const { restored, skipped } = await winMan.restoreClaudeSessions();
  log(`claude-wt restored ${restored.length}, skipped ${skipped.length}`);
},
```

Что важно знать про эту команду:

- **Она долгая.** Между запусками окон стоит пауза 2 секунды
  (`claudeWt.restore.launchDelayMs`): Windows Terminal открывает окна
  асинхронно, и запрошенные подряд всплывают пачкой — тогда «новое окно»
  перестаёт означать «окно этой сессии», позиции разъезжаются по чужим сессиям,
  а часть окон остаётся пустой. Шесть сессий — это порядка 20-30 секунд.
  Обработчик `stdinActions` ничего не блокирует, но пункт трея не даст
  обратной связи, пока не закончит.
- **Она отказывается работать, если сессии открыты.** Если хоть одна сессия из
  плана сейчас на экране, команда ничего не делает и называет её в stderr.
  Это защита от второго окна на тот же транскрипт. `{ force: true }` поднимает
  только недостающие.
- **Она открывает окна терминала** — заметный побочный эффект, поэтому пункт
  трея должен оставаться ручным. Автоматический вызов на старте — отдельный
  флаг `claudeWt.restore.auto` в конфиге windows11-manager, не здесь.

### Опционально: тот же вызов по MQTT

Если нужен и удалённый триггер — в `subscriptions` (`windows.js:280-322`) по
образцу автоплейсера, который ходит и из трея, и из топика через одну функцию.
Прямой HTTP/WS-путь в windows11-manager тоже есть (`POST /claude-wt/restore`,
ws-команда `claude-wt-restore`), но для windows-mqtt он лишний: процесс уже
внутри.

## Проверка

1. `npm test` в windows-mqtt (`node --test test/**/*.test.js`) и
   `cd src-tauri && cargo check` — по AGENTS.md перед коммитом.
2. Запустить windows-mqtt, открыть окно Windows Terminal с сессией Claude Code,
   подождать пару секунд. В `%LOCALAPPDATA%\windows11-manager\claude-wt.json`
   (или что стоит в `statePath`) должен появиться слот с координатами.
3. Выйти из claude в этом окне, подвинуть окно, войти в ту же сессию снова —
   окно должно вернуться на прежнее место примерно через две секунды.
4. Пункт трея: закрыть окна терминала и нажать «Restore claude terminals».
   В логе — `claude-wt restored N, skipped 0`.

## Подводные камни

- **`claudeWtStatus().running` врёт между процессами.** Признак живого вотчера
  хранится в памяти процесса. Если windows-mqtt держит вотчер у себя, то
  `node src claude-wt status` из консоли покажет `running: false`. Не баг
  интеграции, но при отладке сбивает.
- **Два вотчера одновременно — плохо.** Если windows-mqtt запускает свой, не
  надо параллельно держать `node src claude-wt watch` или тумблер в трее самого
  windows11-manager: оба будут писать один файл состояния и дёргать одни окна.
- **`lastLayout` сжимается при живом демоне.** Он хранит состав последнего тика
  с окнами, поэтому сессии, закрытые по одной при работающем вотчере, из него
  выпадают, хотя слоты остаются. Для аварии это неважно (демон умирает вместе с
  машиной), но «восстанови то, что я закрыл руками полчаса назад» так не
  работает — для этого есть `restoreClaudeSessions({ sessionIds: [...] })`.
- **Соглашения windows-mqtt:** conventional commits с именем модуля
  (`feat(windows): start claude-wt watcher`), тесты — только чистая логика, без
  запуска нативных бинарей; `source "$HOME/.cargo/env"` перед любой командой
  cargo.

## Справка по API

| Функция | Что делает |
| --- | --- |
| `startClaudeWt()` | Запускает вотчер (интервал в текущем процессе), проверяет признак аварии |
| `stopClaudeWt()` | Останавливает интервал |
| `claudeWtStatus()` | `{ running, slots, lastLayout, statePath, sessionsFile }` |
| `getClaudeWtConfig()` | Конфиг с подставленными значениями по умолчанию |
| `restoreClaudeSessions({ force, sessionIds })` | Поднимает сессии, возвращает `{ restored, skipped }` |
| `maybeRestoreOnStart()` | Проверка аварии; поднимает только при `restore.auto` |

Дизайн и обоснования: `windows11-manager/docs/specs/2026-07-31-claude-wt-design.md`,
план исполнения: `windows11-manager/docs/plans/2026-07-31-claude-wt.md`.

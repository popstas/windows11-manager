# Переезд управления окнами и claude-wt из windows-mqtt

Дата: 2026-08-08
Статус: утверждён
Затрагивает: `windows11-manager`, `windows-mqtt`, `ccfzf-picker`

## Проблема

Управление окнами и сессиями claude-wt размазано по двум приложениям. Код
живёт в `windows11-manager`, а *хостит* его `windows-mqtt`: он держит
`file:../windows11-manager` и зовёт `winMan` 53 раза — `startClaudeWt()`,
`placeWindowOnOpen()`, `placeWindows()`, здоровье демона. То есть демон
запускает не тот, кому он принадлежит.

Из-за этого:

- MQTT-подписки на окна живут в `windows-mqtt/src/modules/windows.js` (43 КБ),
  хотя `windows11-manager` уже имеет свой мост `MQTT → Rust → WS → Node` и уже
  обрабатывает `place`, `placeAll`, `store`, `restore`, `desktop`,
  `claude-wt-restore`. Часть команд обслуживается дважды.
- Экспорт сессий в Home Assistant (`src/homeassistant/`, 23 КБ) стоит в чужом
  репозитории и зависит от хелперов пикера, которого больше нет.
- Список команд продублирован в `src/http-server.js` и `src/ws-client.js`
  двумя независимыми `switch`.
- `ccfzf-picker` на Windows-хосте собирает команду `wt.exe` сам и теряет
  маппинг проекта на WT-профиль, который знает только `windows11-manager`
  (`profileForCwd`).

Части цепочки, которые уже разъехались правильно и в этой работе не трогаются:
`ccfzf` — агрегатор списка (`--state` / `--dump`), `ccfzf-picker` — интерфейс
выбора. Старый пикер внутри `windows-mqtt` заменён и мёртв.

## Решение

`windows11-manager` забирает себе весь MQTT: и подписку, и публикацию, целиком
в Node. `windows-mqtt` остаётся жить без окон — при нём только питание машины
(`sleep`, `restart`, `shutdown`) и не относящиеся к делу модули (audio, midi,
obs, tts, keys, mouse, clipboard, filewatch, gpt).

Признак раздела: **работа с окнами — в `windows11-manager`, питание машины — в
`windows-mqtt`.** Префикс `home/room/pc/windows/*` остаётся прежним, поэтому
отправителей (плата openHASP, Node-RED, `ccfzf-picker`) править не нужно.

## Карта топиков

Переезжают в `windows11-manager`:

| Группа | Топики |
|---|---|
| Окна | `autoplace`, `store`, `restore`, `clear`, `open_default`, `reload` |
| claude-wt | `claude-restore`, `claude-restore-one`, `claude-focus`, `claude-focus-project`, `claude-focus-slot`, `claude-session-unread`, `claude-session-open`, `claude-snapshots`, `claude-snapshot-restore` |
| Home Assistant | discovery, состояния слотов, командные топики переключателей 1..N |

`place`, `placeAll`, `desktop`, `claude-wt-restore` у менеджера уже есть в
`ws-client.js` — они просто переезжают в роутер.

Удаляются совсем (подача старого пикера `windows-mqtt`, отправителя нет):
`claude-sessions-start`, `claude-sessions-stop`, `claude-sessions-sort-cycle`,
`claude-sessions-toggle`, `claude-session-actions`.

Остаются в `windows-mqtt`: `sleep`, `restart`, `shutdown`, `restart_restore`.
Добавляется ответный `windows/store/done` — его публикует менеджер, слушает
`windows-mqtt` (см. «Развязка»).

**`claude-session-unread` живой.** Его публикует сам `ccfzf-picker`
(`src-tauri/src/mqtt.rs:26`) наряду с `claude-focus` и
`claude-snapshot-restore`. В группу мёртвых он попал по ошибке при разборе;
удалять нельзя.

**`claude-focus-slot` подписывается отдельно** (`windows.js:1083`), не через
общую карту: это нажатия на плате openHASP. Командные топики HA-переключателей
регистрируются ещё одним списком (`windows.js:1110`).

## Роутер команд и транспорты

Появляется `src/commands/router.js` — одна карта `команда → обработчик(payload)`
и единственный список команд в проекте. MQTT и HTTP становятся транспортами
поверх неё; `http-server.js` переписывается так, что URL разрешается в ту же
команду.

Причина, по которой роутер вводится сейчас, а не «когда-нибудь»: два `switch`
уже разъезжаются при пяти командах, а после переезда их станет двадцать.

`src/mqtt/client.js` — клиент на npm-пакете `mqtt`: подписка на `${base}/#`
плюс командные топики HA-переключателей, publish-хелпер, переподключение.
Точка входа `node src/index.js mqtt` — долгоживущий процесс.

Rust-мост удаляется целиком: `tauri-app/src-tauri/src/mqtt.rs`,
`tauri-app/src-tauri/src/ws_server.rs`, `src/ws-client.js`. Поле
`ws_client_child` в `lib.rs` становится `mqtt_child` и спавнит новую точку
входа. Двойной перескок `MQTT → Rust → WS → Node` больше не нужен: раз Node
всё равно заводит клиент ради публикации, пусть он же и слушает.

Настройки брокера остаются в `tauri-plugin-store` — интерфейс настроек трея не
меняется — и передаются node-процессу **переменными окружения**. Не
аргументами: пароль в `argv` виден в списке процессов.

**Сознательная потеря.** Трей сейчас показывает состояние MQTT-подключения,
которое Rust знает изнутри своего клиента. После переезда он показывает
состояние *процесса* (запущен / не запущен), а факт подключения уходит в лог.
Обратный канал ради индикатора не строится.

## Home Assistant

`src/homeassistant/{api,discovery,claude-sessions}.js` переезжают вместе со
своими тестами, CJS → ESM. Цикл публикации (интервал 15 с, `namesFingerprint`
чтобы не слать discovery впустую) живёт в том же mqtt-процессе. Секция
`homeassistant.*` переезжает в конфиг `windows11-manager`.

Из `src/picker/` за экспортом тянутся ровно три файла: `session-slots.js`,
его зависимость `session-groups.js`, и `format-age.js`. За своими топиками
переезжают `restore-payload.js` (`parseRestorePayload` для
`claude-snapshot-restore`), `session-open-helpers.js` и
`claude-project-helpers.js`. Остальное в `src/picker/` удаляется — потребителя
у него не остаётся.

## Развязка windows-mqtt

- Флаг `windows.enabled` в конфиге `windows-mqtt`; после переезда умолчание
  `false`, модуль не грузится вовсе.
- Сохранение раскладки перед перезагрузкой идёт через брокер: `windows-mqtt`
  публикует `windows/store` и перезагружает машину. Это **два** места, а не
  одно: `restart_restore` (`windows.js:1063`) и `restartHandler`
  (`windows.js:926`), где `winMan.storeWindows()` зовётся у любого payload,
  кроме `nostore`.

  Ждать нечего: `windows/store` публикуется с QoS 1, и подтверждение брокера
  говорит лишь о доставке до него, а не о том, что менеджер успел записать
  раскладку. Правильный признак — ответная публикация: менеджер по завершении
  `storeWindows()` шлёт `windows/store/done`, а `windows-mqtt` перезагружает
  машину по ней либо по таймауту в 5 секунд. Без ответного топика перезагрузка
  гонится с записью файла и иногда съедает раскладку.
- `obs.js`: проверка `winMan.findWindow({title:'^OBS'})` убирается. Вместо неё
  — наличие процесса `obs64.exe` (`tasklist /FI "IMAGENAME eq obs64.exe"`), а
  если и это окажется лишним, просто попытка подключиться: она и так стоит в
  `try` и логирует неудачу только первые два раза.
- Rust `windows-mqtt` перестаёт звать `claudeWtProjects()` через
  `node --input-type=module` (`src-tauri/src/main.rs:780`); проектные хоткеи
  регистрирует `ccfzf-picker`.
- `file:../windows11-manager` уходит из `package.json`.

**Критерий готовности этой части:** греп по `windows-mqtt` не находит ни
`winMan`, ни `windows11-manager` в коде — только в комментариях, где на
менеджер ссылаются как на соседа.

Удаляются: `src/modules/windows.js`, `src/homeassistant/`, `src/picker/`.

## ccfzf-picker

Признак «пикер на хосте с оконным трекером» уже вычисляется — `canFocus()` в
`frontend-src/session-windows.js` сравнивает `state.windowHost` из ответа
агрегатора с `CONFIG.windowHost`. Изобретать определение не нужно.

- **Enter на хосте с трекером** — открытие через `windows11-manager` по HTTP на
  петлевом `:9722`, чтобы применился `profileForCwd`. Сейчас пикер собирает
  команду `wt.exe` сам и профиль проекта теряет; это та самая причина, по
  которой маппинг вообще должен жить в менеджере.
- **Отдельное действие «открыть на машине трекера»** → MQTT
  `claude-session-open`. Не по Enter.
- **Enter на чужом хосте** (macOS) — без изменений: локальный терминал через
  ssh. Пикер остаётся самостоятельным там, где менеджера нет.

Заметьте разницу: `canFocus()` дополнительно требует `windowPid > 0`, потому
что подъём окна на Windows требует передачи права переднего плана. Для выбора
способа *открытия* нужен только совпавший хост — предикат берётся отдельный, не
переиспользуется.

## Ошибки и тестирование

Юнит-тестами покрывается:

- карта роутера — каждая команда разрешается в обработчик, неизвестная даёт
  внятную ошибку, а не молчание;
- сборка сущностей Home Assistant — тесты переезжают как есть;
- разбор payload'ов (`parseRestorePayload` и соседи).

Юнитами не покрывается и проверяется руками на Windows: реальный брокер,
подъём и раскладка окон, плата openHASP.

Ручной чеклист после переключения флага:

1. Плата openHASP: нажатие на строку поднимает окно сессии; строки обновляются.
2. Пикер: `claude-focus`, отметка непросмотренного, восстановление снимка.
3. Автораскладка: `autoplace`, `place`, `store`, `restore`, `clear`.
4. Home Assistant: сущности `switch.claude_wt_session_N` живы, атрибут
   `summary` непустой.
5. Питание: `restart_restore` сохраняет раскладку до перезагрузки.

## Выкатка

Код едет одним PR в каждый репозиторий — промежуточных состояний нет.
Переключение — рантайм-флагом: ставим новое рядом со старым, переключаем
`windows.enabled` в `false`, проходим чеклист. При провале возвращаем флаг;
откатывать релизы не нужно.

## Риски

1. **Переходный дубль.** Пока флаг не переключён, оба приложения подписаны на
   одни топики и оба отработают команду. Флаг — единственная защита; параллельно
   их не гонять.
2. **Retained discovery от старого приложения** останется в брокере. Совпадут
   `object_id` — переедет само; не совпадут — чистить вручную. Карта скилла уже
   отмечает, что `object_id` в `discovery.js` и настоящие `entity_id`
   расходятся (`switch.claude_wt_session_N` против `claude_session_N`).
3. **Правила про SMB-кэш и бюджет опроса** из
   `.claude/skills/claude-wt/SKILL.md` действуют и после переезда: код меняет
   дом, а сетевой диск остаётся тем же. `loadProgress()` по-прежнему зовётся
   только из view-слоя, `getWindows()` по-прежнему не крутится в цикле демона.

## Границы

- `ccfzf` не трогается: агрегатор уже отдаёт `--state` / `--dump` и читает файл
  оконного трекера.
- Интерфейс `ccfzf-picker` не переделывается — добавляется одна ветка открытия
  и одно действие.
- Модули `windows-mqtt`, не относящиеся к окнам, остаются на месте, включая
  `keys/press-throttled` и `filewatch/openhasp`, которые входят в цепочку
  claude-wt по карте скилла.
- Смена формата конфига на yml и HTTP-интерфейс, дублирующий mqtt, — отдельные
  пункты `docs/TODO.md`, в эту работу не входят.
- После переезда карту в `.claude/skills/claude-wt/SKILL.md` надо переписать:
  таблица «Кто где живёт» и раздел про деплой `windows-mqtt` станут неверными.

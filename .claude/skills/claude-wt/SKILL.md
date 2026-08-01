---
name: claude-wt
description: Use when working on claude-wt session tracking anywhere in the chain — the daemon in windows11-manager, the picker or Home Assistant export in windows-mqtt, the agent hooks on the V: drive, or the openHASP panel config on R:. Also use when a session shows the wrong status, a panel row does not update, or a change appears not to have taken effect.
---

# claude-wt: связка четырёх мест

Список работающих агентов Claude Code, собранный из четырёх независимых частей. Состояние течёт в одну сторону, нажатия — в обратную, и каждая граница между частями уже приносила по багу.

## Кто где живёт

| Часть | Где | Роль |
|---|---|---|
| Хуки агента | pc-virt, `~/.claude/hooks/`, с Windows это `V:` | Пишут `<id>.state.json` на каждое событие агента |
| Демон и библиотека | `D:/projects/js/windows11-manager`, `src/claude-wt/` | Следит за окнами, читает состояния, снимки, CLI |
| Приложение | `D:/projects/js/windows-mqtt` | Пикер, MQTT, экспорт в Home Assistant. Зависит от первого через `file:../windows11-manager` |
| Панель | shome, `~/projects/smarthome/home-assistant/config/`, с Windows это `R:` | Генератор конфига openHASP, Node-RED, плата `openhasp5` |

## Поток

**Туда:** хук → `V:/.claude/claude-wt/<id>.state.json` → `loadProgress()` → `claudeWtSessions()` → пикер и MQTT Discovery → сущности Home Assistant → шаблоны в `conf/openhasp.yaml` → текст объекта на плате.

**Обратно:** нажатие на плате → `home/room/pc/windows/claude-focus-slot` (номер строки, не id сессии) → `claudeFocusSlot()` → фокус окна. Демон видит переход фокуса на своём тике и ставит `focusedAt` — отсюда «просмотрено».

Геометрию страницы плата получает не от Home Assistant: `openhasp_lines.yaml` читает Node-RED и шлёт как jsonl в `hasp/openhasp5/command`. Тексты и подсветку — от Home Assistant по `conf/openhasp.yaml`. Это два разных пути, и ломаются они по-разному.

## Правила, за которые уже заплачено

**Бюджет опроса.** Ни `getWindows()`, ни чтения номера рабочего стола в цикле демона — см. AGENTS.md. Чтение транскриптов и каталога состояний с сетевого диска подчиняется тому же правилу: `loadProgress()` вызывается только из view-слоя, сводку считает хук на своей стороне, где файл локальный.

**`mtime` на сетевом диске врёт.** Долгоживущий процесс минутами получает от `statSync()` прежнюю отметку, пока свежий видит новую: клиент SMB отдаёт закэшированные атрибуты. Кэш, который верит одному mtime, отдаёт устаревшее содержимое. В `progress.js` у записи поэтому есть срок годности.

**Home Assistant обрезает результат шаблона по краям.** Ведущий пробел не доживёт — ни обычный, ни неразрывный. Проверяется одним вызовом `/api/template`.

**entity_id не тот, что в discovery.** В `discovery.js` стоит `object_id: claude_session_N`, а зарегистрированы `switch.claude_wt_session_N`. Настоящие имена смотреть в `/api/states`, а не в коде.

**Ключи атрибутов строчные.** Home Assistant капитализирует подписи в интерфейсе; `state_attr(..., "Summary")` вернёт `None`.

**У кнопки openHASP отступа текста нет.** Подпись — дочерний label, которому в `hasp_attribute.cpp:1629` ставят ширину всей кнопки и выравнивают по её координатам. `pad_left` плата примет и сохранит, но не нарисует. Вторая строка делается отдельным объектом через `parentid` (`hasp_object.cpp:250`); клики он не перехватывает.

**Пустой payload в MQTT — это запрос, а не очистка.** `mosquitto_pub -t hasp/openhasp5/command/p3b11.text -m ""` вернёт значение в `hasp/openhasp5/state/p3b11`. Чтобы стереть, шлите пробел.

**Новый объект в `openhasp_buttons.yaml` панель не увидит без перезагрузки записи.** Компонент читает YAML в `async_setup_entry`. Лечится `homeassistant.reload_config_entry` на `light.openhasp5_backlight` — рестарт Home Assistant не нужен.

**Генератор пишет файл только при изменении содержимого.** `touch` на источнике ничего не даст: наблюдатель отработает, файл не изменится, Node-RED не заметит. Проверять регенерацию по содержимому, а не по mtime.

## Команды

```bash
node src/index.js claude-wt status
node src/index.js snapshots-list
node src/index.js snapshots-restore last
```

`npm run deploy-fast` в windows-mqtt — секунды, копирует node-часть в установленное приложение. Интерфейс пикера вшит в бинарник, поэтому правки `sessions.html` и `frontend-src/` требуют `npm run deploy-local`; скрипт сам это проверяет и отказывается.

## Частые ошибки

| Симптом | Причина |
|---|---|
| Статус сессии не тот | Кэш `loadProgress` держит старое: mtime по SMB не сдвинулся |
| Правка панели «не доехала» | Home Assistant не перечитал `conf/openhasp.yaml` |
| Сводка пустая на панели | Ключ атрибута с большой буквы |
| Отступ текста в кнопке не появляется | У кнопки openHASP его нет в принципе |
| Две сессии с одним заголовком путаются | Флаг `live` в дампе ccfzf врёт; побеждает свежая отметка хука |
| `deploy-local` висит часами | Приложение наследует stdout; должно быть `stdio: 'ignore'` |

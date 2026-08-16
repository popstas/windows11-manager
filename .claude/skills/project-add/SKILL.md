---
name: project-add
description: Добавить проект в claudeWt.projects конфига windows11-manager, чтобы его сессии Claude открывались в своём профиле Windows Terminal. Пользователь называет путь к проекту на pc-virt и профиль — home или work. Триггеры — /project-add, "добавь проект", "добавь проект в claude-wt", "новый проект home", "новый проект work", "распредели проект по профилю", "заведи проект <путь>".
---

# Добавление проекта в claudeWt.projects

## Файл

`C:/Users/popstas/AppData/Roaming/windows-mqtt/windows11-manager.config.js`

Это и есть тот конфиг, который читает приложение: `resolveConfigPath()` в `src/config.js` перебирает четыре пути, и `%APPDATA%\windows-mqtt\...` стоит первым. Каталог назван по windows-mqtt по историческим причинам — claude-wt из того проекта уехал целиком, а имя каталога осталось. Правка по `~/.config/windows11-manager.config.js` (третий путь в переборе) не даст ни эффекта, ни ошибки.

С pc-virt тот же файл виден как `D:/projects/js/windows-mqtt/data/windows-mqtt/windows11-manager.config.js` — симлинк на него. Правка сразу рабочая, копировать никуда не нужно.

Формат — CommonJS, `module.exports` в конце файла. Нужный блок — `claudeWt.projects`.

## Формат записи

```js
      {
        name: 'talks-reducer',
        cwd: '/home/popstas/projects/python/talks-reducer',
        profile: 'home-project',
      },
```

Отступ — шесть пробелов у открывающей скобки, восемь у полей; кавычки одинарные, висячая запятая после последнего поля. Ставить запись последней в массиве, перед `],`.

`hotkey` **не добавлять**. Он есть только у `home` и `expertizeme`, и регистрирует его не этот проект, а ccfzf-picker (`src-tauri/src/project_hotkeys.rs`) при старте — новый хоткей потребовал бы перезапуска пикера. Без хоткея перезапуск не нужен: `getConfig()` перечитывает файл на каждый вызов, поэтому профиль подхватится со следующего запуска сессии.

## Профили

| Что сказал пользователь | `profile` |
|---|---|
| home | `home-project` |
| work | `work-project` |

Оба профиля уже заведены в Windows Terminal. Если пользователь назовёт профиль, которого нет в списке профилей WT (`C:/Users/popstas/AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json`, `profiles.list[].name`) — сказать об этом и не выдумывать замену: WT молча откроет профиль по умолчанию, и разбираться потом будет неоткуда.

## Шаги

1. **Достроить путь.** Пользователь называет его по-разному. Короткое `js/foo` или `python/foo` — это `/home/popstas/projects/js/foo`. Путь, начинающийся с `/home/`, брать как есть. Хвостовой слеш убрать.

2. **Проверить, что каталог существует:**

   ```bash
   ssh -o BatchMode=yes popstas@pc-virt.popstas.pro "test -d '<cwd>' && echo ok || echo missing"
   ```

   Нет каталога — остановиться и сказать пользователю. Запись с несуществующим `cwd` не сломает конфиг, но не сработает никогда, а выяснится это через неделю.

3. **Предложить `name`** — последний сегмент пути — и дать поправить одним словом. Пользователь сокращает имена (`claude-statusline-todo` → `statusline`), поэтому механическое правило промахивается. Имя уходит в `claude -n '{name}'` и становится заголовком окна.

4. **Проверить, что записи ещё нет.** Искать по `cwd` и по `name` отдельно:
   - тот же `cwd` — проект уже заведён, показать текущий `profile` и спросить, менять ли его;
   - то же `name` при другом `cwd` — отказаться и попросить другое имя. Демон привязывает сессии к окнам по заголовку, и два проекта с одинаковым именем дадут два окна с одним заголовком; победит окно с большим hwnd, а вторая сессия пропадёт из списка.

5. **Вставить запись** последней в массив `claudeWt.projects`.

6. **Проверить, что файл цел:**

   ```bash
   node -e "const c=require('C:/Users/popstas/AppData/Roaming/windows-mqtt/windows11-manager.config.js'); const p=c.claudeWt.projects; console.log(p.length, JSON.stringify(p[p.length-1]))"
   ```

   Синтаксическая ошибка здесь означает, что приложение останется на прошлом конфиге и будет молча игнорировать правку.

7. **Проверить, что профиль подхватился:**

   ```bash
   node -e "Promise.all([import('file:///D:/projects/js/windows11-manager/src/claude-wt/project-helpers.js'),import('file:///D:/projects/js/windows11-manager/src/claude-wt/index.js')]).then(([h,i])=>console.log(JSON.stringify(h.profileForTerminal('<cwd>', 'wt', i.getClaudeWtConfig()))))"
   ```

   Должно напечатать `"home-project"` или `"work-project"`. Пустая строка или `"popstas"` — значит `cwd` не совпал.

   Три особенности, все проверены и все неочевидны: `profileForTerminal` наружу из пакета не экспортируется, поэтому импорт идёт прямо из `project-helpers.js`; абсолютный путь Windows в динамическом `import()` обязан быть `file:///`-URL, иначе node падает с `ERR_UNSUPPORTED_ESM_URL_SCHEME`; и второй аргумент — имя терминала, `'wt'` здесь неслучайно: у записей этого скилла профиль лежит в плоском поле `profile`, а оно читается как профиль именно терминала `wt` (см. докстроку `profileForTerminal`).

## Почему `cwd` должен совпадать точно

`profileForTerminal()` в `windows11-manager/src/claude-wt/project-helpers.js` ищет `projects.find(p => p.cwd === cwd)` — строгое равенство, без нормализации и без префиксного совпадения. Лишний слеш, другой регистр или `~` вместо `/home/popstas` — и проект молча получит профиль по умолчанию (`claudeWt.profile`, сейчас `popstas`).

## Границы

Скилл только добавляет запись в конфиг. Он не создаёт профили в Windows Terminal, не назначает хоткеи и не деплоит приложение — правка конфига этого не требует.

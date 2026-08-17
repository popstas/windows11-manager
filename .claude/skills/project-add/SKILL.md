---
name: project-add
description: Добавить проект в claudeWt.projects конфига windows11-manager, чтобы его сессии Claude открывались в своём профиле Windows Terminal. Пользователь называет путь к проекту на pc-virt и профиль — home или work. Триггеры — /project-add, "добавь проект", "добавь проект в claude-wt", "новый проект home", "новый проект work", "распредели проект по профилю", "заведи проект <путь>".
---

# Добавление проекта в claudeWt.projects

## Файл

`C:/Users/popstas/AppData/Roaming/windows-mqtt/windows11-manager.config.yaml`

Это и есть тот конфиг, который читает приложение: `resolveConfigPath()` в `src/config.js` перебирает пять путей, и `%APPDATA%\windows-mqtt\...` стоит первым. Каталог назван по windows-mqtt по историческим причинам — claude-wt из того проекта уехал целиком, а имя каталога осталось. Расширение конфига — только `.yaml`, второго имени `.yml` в проекте нет. Правка по `~/.config/windows11-manager.config.yaml` (третий путь в переборе) не даст ни эффекта, ни ошибки — там файла нет.

С pc-virt тот же файл виден как `D:/projects/js/windows-mqtt/data/windows-mqtt/windows11-manager.config.yaml` — симлинк на него. Правка сразу рабочая, копировать никуда не нужно.

Формат — YAML. Служебный ключ верхнего уровня `x-anchors` объявляет константы (`&имя`), использования — через merge-ключ `<<: *имя`; загрузчик `x-anchors` из итогового конфига вырезает. Образец формата — `config.example.yaml` в корне репозитория windows11-manager. Нужный блок — `claudeWt.projects`.

## Формат записи

```yaml
    - name: talks-reducer
      cwd: /home/popstas/projects/python/talks-reducer
      profiles: { wt: home-project }
```

Отступ — как у соседних элементов `claudeWt.projects` в живом файле; программная правка (шаг 5) сама встраивается в текущую структуру массива, подбирать отступ руками не нужно.

`hotkey` **не добавлять**. Он есть только у `home` и `expertizeme`, и регистрирует его не этот проект, а ccfzf-picker (`src-tauri/src/project_hotkeys.rs`) при старте — новый хоткей потребовал бы перезапуска пикера. Без хоткея перезапуск не нужен: `getConfig()` перечитывает файл при смене mtime, поэтому профиль подхватится со следующего запуска сессии.

## Профили

| Что сказал пользователь | `profiles.wt` |
|---|---|
| home | `home-project` |
| work | `work-project` |

Оба профиля уже заведены в Windows Terminal. Профили — свои у каждого терминала (у wt они есть, у wezterm нет), поэтому в записи это карта `profiles: { wt: ... }`, а не плоское поле. Старое плоское `profile` тоже продолжает работать и значит то же самое (профиль терминала wt), но новые записи писать картой `profiles`. Если пользователь назовёт профиль, которого нет в списке профилей WT (`C:/Users/popstas/AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json`, `profiles.list[].name`) — сказать об этом и не выдумывать замену: WT молча откроет профиль по умолчанию, и разбираться потом будет неоткуда.

## Шаги

1. **Достроить путь.** Пользователь называет его по-разному. Короткое `js/foo` или `python/foo` — это `/home/popstas/projects/js/foo`. Путь, начинающийся с `/home/`, брать как есть. Хвостовой слеш убрать.

2. **Проверить, что каталог существует:**

   ```bash
   ssh -o BatchMode=yes popstas@pc-virt.popstas.pro "test -d '<cwd>' && echo ok || echo missing"
   ```

   Нет каталога — остановиться и сказать пользователю. Запись с несуществующим `cwd` не сломает конфиг, но не сработает никогда, а выяснится это через неделю.

3. **Предложить `name`** — последний сегмент пути — и дать поправить одним словом. Пользователь сокращает имена (`claude-statusline-todo` → `statusline`), поэтому механическое правило промахивается. Имя уходит в `claude -n '{name}'` и становится заголовком окна.

4. **Проверить, что записи ещё нет.** Искать по `cwd` и по `name` отдельно:
   - тот же `cwd` — проект уже заведён, показать текущий `profiles.wt` (или `profile`) и спросить, менять ли его;
   - то же `name` при другом `cwd` — отказаться и попросить другое имя. Демон привязывает сессии к окнам по заголовку, и два проекта с одинаковым именем дадут два окна с одним заголовком; победит окно с большим hwnd, а вторая сессия пропадёт из списка.

5. **Вставить запись** через Document API пакета `yaml` — обычные `parse` + `stringify` уничтожили бы комментарии соседних записей, а комментарии в этом конфиге — документация формата (см. пояснения рядом с `claudeWt.projects` и `x-anchors` в `config.example.yaml`). Выполнить из каталога репозитория (на pc-virt — `D:/projects/js/windows11-manager`; там установлен пакет `yaml`, поэтому голый `import 'yaml'` резолвится через его `node_modules`):

   ```js
   import fs from 'node:fs';
   import { parseDocument } from 'yaml';

   const file = 'C:/Users/popstas/AppData/Roaming/windows-mqtt/windows11-manager.config.yaml';
   const doc = parseDocument(fs.readFileSync(file, 'utf8'));
   let projects = doc.getIn(['claudeWt', 'projects']);
   if (!projects) {
     // На случай, если `projects:` в живом конфиге ещё не заведён вовсе.
     projects = doc.createNode([]);
     doc.setIn(['claudeWt', 'projects'], projects);
   }
   projects.add(doc.createNode({ name: '<name>', cwd: '<cwd>', profiles: { wt: '<профиль>' } }));
   // doc.toString({ lineWidth: 0 }), а не голый String(doc): у голого свой
   // lineWidth 80 по умолчанию, и он переносит по строкам не только новую
   // запись, но и не связанные с ней длинные строки вроде launch.args.
   fs.writeFileSync(file, doc.toString({ lineWidth: 0 }), 'utf8');
   ```

   Комментарии соседних записей после этого остаются на месте по содержанию.
   Мелкая перестройка форматирования вокруг них (двойной пробел перед `#`
   схлопывается в один, `['a', 'b']` может стать `[ 'a', 'b' ]`) — это
   собственная нормализация библиотеки `yaml` при пересборке файла, не потеря
   текста; проверено на копии `config.example.yaml`.

6. **Проверить, что правка не задела ничего лишнего.** До правки снять копию
   файла (`cp <файл> <файл>.before`), после — сравнить:

   ```bash
   node src/index.js config-verify <файл>.before C:/Users/popstas/AppData/Roaming/windows-mqtt/windows11-manager.config.yaml
   ```

   выполнить из каталога репозитория. Ожидание: ровно одно расхождение —
   добавленный проект (`claudeWt.projects[N]`), код выхода 1. Любое другое
   расхождение, отсутствие расхождений (код 0 — правка не применилась) или
   ошибка разбора — остановиться и разобраться, не переходить к шагу 7.

7. **Проверить, что профиль подхватился:**

   ```bash
   node -e "Promise.all([import('file:///D:/projects/js/windows11-manager/src/claude-wt/project-helpers.js'),import('file:///D:/projects/js/windows11-manager/src/claude-wt/index.js')]).then(([h,i])=>console.log(JSON.stringify(h.profileForTerminal('<cwd>', 'wt', i.getClaudeWtConfig()))))"
   ```

   Должно напечатать `"home-project"` или `"work-project"`. Пустая строка или
   `"popstas"` — значит `cwd` не совпал.

   Три особенности, все проверены и все неочевидны: `profileForTerminal`
   наружу из пакета не экспортируется, поэтому импорт идёт прямо из
   `project-helpers.js`; абсолютный путь Windows в динамическом `import()`
   обязан быть `file:///`-URL, иначе node падает с
   `ERR_UNSUPPORTED_ESM_URL_SCHEME`; и второй аргумент — имя терминала, `'wt'`
   здесь неслучайно: запись этого скилла хранит профиль в карте
   `profiles.wt`, а читается она именно для терминала `wt` (см. докстроку
   `profileForTerminal`).

## Почему `cwd` должен совпадать точно

`profileForTerminal()` в `windows11-manager/src/claude-wt/project-helpers.js` ищет `projects.find(p => p.cwd === cwd)` — строгое равенство, без нормализации и без префиксного совпадения. Лишний слеш, другой регистр или `~` вместо `/home/popstas` — и проект молча получит профиль по умолчанию (`claudeWt.profile`, сейчас `popstas`).

## Границы

Скилл только добавляет запись в конфиг. Он не создаёт профили в Windows Terminal, не назначает хоткеи и не деплоит приложение — правка конфига этого не требует.

# Claude WT unified launch

Дата: 2026-08-03
Статус: утверждён

Связанный спек: `docs/specs/2026-08-02-claude-wt-profile-design.md`
(частично перекрывается: таблица Resolution для restore/snapshot и владение `claudeProjects`).

## Проблема

Открытие Claude-сессии размазано по трём реализациям:

1. `claudeWt.launch` + `cfg.profile` — restore / snapshot / picker restore-one
2. `claudeWt.launchNew` + `project.profile ?? cfg.profile` — project hotkey
3. `sshApp` shell-строка — picker «Open in Terminal»

После введения `claudeWt.profile` restore/snapshot всегда ставят глобальный
профиль (`popstas`). Сессия ExpertizeMe из снапшота открывается не в том
WT-профиле: `cwd` сессии есть, маппинг на `claudeProjects` — нет.

`claudeProjects` живёт в yaml windows-mqtt; hotkeys парсит Rust из того же
yaml. Manager о проектах не знает и не может резолвить профиль по cwd.

## Решение

Один билдер argv + один spawn в windows11-manager. Список проектов (включая
hotkey и profile) переезжает в `windows11-manager.config.js`. windows-mqtt
(node и Rust) читает проекты через API manager’а, не из yaml.

### Конфиг (windows11-manager)

```js
claudeWt: {
  profile: 'popstas', // fallback, когда cwd не совпал ни с одним проектом
  projects: [
    {
      name: 'home',
      cwd: '/home/popstas/projects/text/obsidian/home',
      hotkey: 'Ctrl+F11',
      profile: 'home',
    },
    {
      name: 'expertizeme',
      cwd: '/home/popstas/projects/text/obsidian/ExpertizeMe',
      hotkey: 'Ctrl+F12',
      profile: 'ExpertizeMe',
    },
  ],
  launch: {
    command: 'wt.exe',
    args: ['-w', '-1', 'ssh', '-A', 'host', '-t', 'ccfzf --session {id} --kiosk'],
  },
  launchNew: {
    command: 'wt.exe',
    args: ['-w', '-1', 'ssh', '-A', 'host', '-t', "cd '{cwd}' && exec claude -n '{name}'"],
  },
}
```

- `projects` — массив; default `[]`. Exact match по `cwd`.
- Поля проекта: `name`, `cwd` обязательны; `hotkey`, `profile` опциональны.
- `launch` / `launchNew` остаются двумя шаблонами (не склеиваем в этом спеке).
- В example-конфиге — закомментированный пример `projects`, без чужих имён.

### API (windows11-manager → windows-mqtt)

```js
getClaudeWtConfig().projects  // через mergeClaudeWtConfig
claudeWtProjects()            // нормализованный список [{ name, cwd, hotkey?, profile? }]
profileForCwd(cwd, cfg?)      // pure: matching project.profile ?? cfg.profile ?? ''
planWtLaunch({ launch, vars, profile })
  // substitute placeholders in launch.args → applyWtProfile → { command, args }
```

`profileForCwd`: exact `cwd` match in `cfg.projects`. Нет match → `cfg.profile ?? ''`.
Match без своего `profile` → тоже fallback на `cfg.profile ?? ''`.

`planLaunchNew` / arg-сборка в `planRestore` / `planSnapshotRestore` сводятся к
`planWtLaunch` (тонкие обёртки или прямой вызов — на усмотрение плана, дублирования
substitute+apply быть не должно).

`openClaudeProject`, restore, snapshot, picker Terminal — готовят `vars` и зовут
`planWtLaunch` + тот же `spawn(..., { detached: true, stdio: 'ignore' })`.

### Resolution профиля (заменяет таблицу из profile-спека)

| Путь | Шаблон | Profile |
|---|---|---|
| restore / snapshot / restore-one | `launch` + `{id}` | `profileForCwd(slot/session.cwd)` |
| project hotkey / `openClaudeProject` | `launchNew` + `{cwd}`/`{name}` | `profileForCwd(project.cwd)` |
| picker «Open in Terminal» | `launch` + `{id}` (reopen) | `profileForCwd(session.cwd)` |

Picker Terminal для карточки сессии = reopen по `id` через
`restoreClaudeSessions({ sessionIds: [id] })` (тот же путь, что restore-one).
Отдельный `openClaudeSession` не вводим. Shell в cwd без ccfzf — вне скоупа.

Пустая строка / отсутствие → `-p` не передаём (`applyWtProfile` как сейчас).

### windows-mqtt

**Node**

- `globalConfig.claudeProjects` → `winMan.claudeWtProjects()` (или
  `getClaudeWtConfig().projects`).
- `claudeFocusProject`, `attachProjectHotkeys`, session feed — тот же список.
- Picker Terminal: убрать shell-ветку `sshApp` / `buildOpenCommands` для
  action `terminal`; звать `restoreClaudeSessions({ sessionIds: [id] })`.
- Из `config.yml` / `config.example.yml` удалить `claudeProjects`.

**Rust**

- Перестать читать `claudeProjects` из yaml (`parse_claude_projects` /
  `read_claude_projects` удалить вместе с yaml-тестами на них).
- При старте получить проекты синхронно через one-shot node. Пакет ESM
  (`"type": "module"`), поэтому не `require`:

  ```
  node --input-type=module -e "import m from 'windows11-manager'; process.stdout.write(JSON.stringify(m.claudeWtProjects()))"
  ```

  cwd процесса — app root с `node_modules/windows11-manager` (как у живого
  приложения; тот же config resolution, что у библиотеки). Парсить JSON
  `[{ name, cwd, hotkey?, profile? }, …]`, регистрировать hotkeys как сейчас
  (`windows/claude-focus-project` + name).
- Записи без `name` / `cwd` / `hotkey` пропускать.

### Личный конфиг (вне репо)

- Перенести `claudeProjects` из `%APPDATA%/windows-mqtt/config.yml` в
  `claudeWt.projects` в `windows11-manager.config.js`.
- Убедиться, что restore/snapshot после фикса дают ExpertizeMe → `-p ExpertizeMe`.

## Call sites

**windows11-manager**

- `CLAUDE_WT_DEFAULTS.projects = []`
- `profileForCwd` + `planWtLaunch` (pure helpers)
- `planRestore` / `planSnapshotRestore` — per-item profile из cwd слота/снимка
- `openClaudeProject` — через `planWtLaunch`
- `claudeWtProjects()` export из lib
- тесты: резолв по cwd, restore с разными cwd → разные `-p`, Terminal path
- `config.example.cjs` — `projects` закомментировать

**windows-mqtt**

- node: проекты из manager API
- picker Terminal → `restoreClaudeSessions({ sessionIds })`, не sshApp
- Rust: ESM one-shot `claudeWtProjects()`; yaml `claudeProjects` убрать
- example yml / тесты tauri-config обновить (секция claudeProjects → ссылка
  на manager config / API)

## Вне скоупа

- Склейка `launch` + `launchNew` в один шаблон
- explorer / cursor actions пикера
- AHK
- Системный дефолтный профиль Windows Terminal
- Запись `profile` в слот/снапшот (отклонённый подход 3)
- Правка `applyWtProfile` strip-scope для `ssh -p` (отдельный finding)

## Не-цели / явные отказы

- Не держать проекты в двух местах (yaml + js).
- Не резолвить профиль на стороне mqtt для restore (manager владеет cwd→profile).

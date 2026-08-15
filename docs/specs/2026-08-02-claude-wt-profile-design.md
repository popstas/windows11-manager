# Claude WT profile

Дата: 2026-08-02
Статус: утверждён

## Проблема

`-p popstas` зашит в `claudeWt.launch` / `launchNew` args и в example-конфигах.
Разным проектам нужны разные профили Windows Terminal (`home`, `ExpertizeMe`),
а дефолт в репозитории не должен тащить чужое имя профиля.

В живом `claudeProjects` поле `profile` уже проставлено, но код его не читает.

## Решение

Отдельное поле профиля + strip-and-reinject при сборке argv.

### Конфиг

**windows11-manager** (`claudeWt`):

```js
claudeWt: {
  profile: 'popstas', // опционально; пусто/нет → без -p
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

**windows-mqtt** (`claudeProjects`):

```yaml
claudeProjects:
  - name: home
    cwd: /home/popstas/projects/text/obsidian/home
    hotkey: Ctrl+F11
    profile: home          # опционально; перекрывает claudeWt.profile для launchNew
  - name: expertizeme
    cwd: /home/popstas/projects/text/obsidian/ExpertizeMe
    hotkey: Ctrl+F12
    profile: ExpertizeMe
```

В example-конфигах: без `popstas`, `profile` задокументирован как опция.
`ssh_app` не меняем.

### Resolution

| Путь | Profile |
|---|---|
| `launch` / restore / snapshots | `claudeWt.profile` или `''` |
| `launchNew` (project hotkey) | `project.profile ?? claudeWt.profile ?? ''` |

Пустая строка / отсутствие поля → аргумент `-p` не передаём.

### Injection

Pure-хелпер `applyWtProfile(args, profile)`:

1. Убрать существующую пару `-p` / `<name>` из `args`.
2. Если `profile` truthy — вставить `['-p', profile]` после флагов окна wt
   (`-w <n>`, если есть), иначе в начало args.

Примеры:

- `['-w','-1','ssh',…]` + `'home'` → `['-w','-1','-p','home','ssh',…]`
- `['-w','-1','-p','popstas','ssh',…]` + `'home'` → то же (старый `-p` снят)
- `['ssh',…]` + `''` → без изменений

`planLaunchNew` принимает `profile` и вызывает `applyWtProfile` после
подстановки `{cwd}` / `{name}`. Restore/snapshot launch builders — то же
с `cfg.profile`.

## Call sites

**windows11-manager**

- `mergeClaudeWtConfig` — `profile: ''` в defaults
- `openClaudeProject({ cwd, name, profile })` → resolved profile в `planLaunchNew`
- restore / snapshot launch — `applyWtProfile(args, cfg.profile)`
- тесты на strip/insert и override
- `config.example.cjs` — убрать `-p popstas` из args; `profile` закомментировать

**windows-mqtt**

- `resolveClaudeProject` — пробрасывать `profile`
- `claudeFocusProject` → `openClaudeProject({ …, profile: project.profile })`
- `config.example.yml` — опциональный `profile` у проекта
- Rust `parse_claude_projects` не трогаем: хоткею поле не нужно

**Личный конфиг (вне репо)**

- `claudeWt.profile: 'popstas'`, выкинуть `-p popstas` из `launch` / `launchNew` args
- `claudeProjects[].profile` уже есть — оставить

## Вне скоупа

- `modules.exec.ssh_app` / открытие сессий из пикера через строковый sshApp
- AHK
- системный дефолтный профиль Windows Terminal

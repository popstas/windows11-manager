# Claude project hotkeys

Дата: 2026-08-02
Статус: утверждён

## Проблема

Home и ExpertizeMe открывались отдельными mintty-терминалами (`homez` / `ez` через
zellij) по Ctrl+F11 / Ctrl+F12 в AutoHotkey. Менеджер сессий claude-wt уже ведёт
обычные Windows Terminal-сессии Claude; отдельные терминалы для «рабочих» проектов
лишние.

## Решение

Проекты описываются в `windows-mqtt` `config.yml`. Tauri регистрирует их хоткеи.
Нажатие фокусирует последнюю **открытую** сессию с точным `cwd` проекта; если
открытой нет — запускает новый `claude -n <name>` в этой папке.

```yaml
claudeProjects:
  - name: home
    cwd: /home/popstas/projects/text/obsidian/home
    hotkey: Ctrl+F11
  - name: expertizeme
    cwd: /home/popstas/projects/text/obsidian/ExpertizeMe
    hotkey: Ctrl+F12
```

## Поведение

1. Hotkey → IPC `windows/claude-focus-project` `{ name }`.
2. Lookup `cwd` по `name` в `claudeProjects`.
3. Среди сессий с `open && cwd === project.cwd` выбрать max `focusedAt`, иначе
   max `lastActivity`.
4. Есть окно → переключить виртуальный стол (live) + `focusWindowById`.
5. Нет → spawn `claudeWt.launchNew` с подстановкой `{cwd}` и `{name}`
   (`claude -n '{name}'` в cwd). Не resume через `ccfzf --session`, не zellij.

## Границы

- Конфиг проектов — только mqtt yaml (хоткеи нужны Rust при старте).
- Ядро выбора/spawn — `windows11-manager` (`openClaudeProject`).
- AHK `^F11`/`^F12` в `terminal-quake-home.ahk` комментируются.
- Вне скоупа: resume закрытой сессии, prefix-match cwd, pin/FancyZones из AHK.

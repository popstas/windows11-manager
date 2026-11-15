AGENTS.md

## Workflow
- Закончил фичу — выкати её на ноутбук nb: `./data/scripts/deploy-pc.sh` (цель по умолчанию — `nb.popstas.pro`). Здесь проверить можно только тесты и сборку, работает код на той машине.
- popstas-pc исключён из выкаток и правок (решение Стаса 2026-11-15: claude-wt там не используется с октября 2026). Не деплоить туда, не править его конфиг и AutoHotkey, не проверять на нём фичи — пока Стас не скажет иначе.

## Quick reference
- Config (живой, на nb): `C:\Users\popstas\AppData\Roaming\windows-mqtt\windows11-manager.config.yaml` — первый путь в `resolveConfigPath()`; `~/.config/windows11-manager.config.yaml` там не существует
- Деплой на Windows: `./data/scripts/deploy-pc.sh` (вне git), по умолчанию на nb
- Ноутбук nb: ssh-хост `nb.popstas.pro` (голое `nb` не резолвится), репо `C:\projects\js\windows11-manager`, конфиг `%APPDATA%\windows-mqtt\windows11-manager.config.yaml`. Деплой: `./data/scripts/deploy-pc.sh`. Лог: `C:\projects\js\windows11-manager\data\windows11-manager.log`
- Конфиги машин не смешивать: правка «на nb» — только конфиг nb. Конфиг правится scp'ом целиком (UTF-8 без BOM), перед заливкой — бэкап `.bak-<дата>` рядом
- FancyZones data: `C:\Users\popstas\AppData\Local\Microsoft\PowerToys\FancyZones\`
- Run placement: `node src/index.js place`
- If placement coordinates are wrong, check `editor-parameters.json` for stale DPI values — a reboot fixes it
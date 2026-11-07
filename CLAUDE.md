AGENTS.md

## Workflow
- Закончил фичу — выкати её на Windows: `ssh popstas-pc` + `./data/scripts/deploy-pc.sh`. Здесь проверить можно только тесты и сборку, работает код на той машине.

## Quick reference
- Config (живой, на popstas-pc): `C:\Users\popstas\AppData\Roaming\windows-mqtt\windows11-manager.config.yaml` — первый путь в `resolveConfigPath()`; `~/.config/windows11-manager.config.yaml` там не существует
- Деплой на Windows: `ssh popstas-pc` + `./data/scripts/deploy-pc.sh` (вне git)
- Ноутбук nb: ssh-хост `nb.popstas.pro` (голое `nb` не резолвится), репо `C:\projects\js\windows11-manager`, конфиг там же, где на popstas-pc (`%APPDATA%\windows-mqtt\windows11-manager.config.yaml`). Деплой: `TARGET_HOST=nb.popstas.pro REPO='C:\projects\js\windows11-manager' ./data/scripts/deploy-pc.sh`. Лог: `C:\projects\js\windows11-manager\data\windows11-manager.log`
- Конфиги машин не смешивать: правка «на nb» — только конфиг nb. Конфиг правится scp'ом целиком (UTF-8 без BOM), перед заливкой — бэкап `.bak-<дата>` рядом
- FancyZones data: `C:\Users\popstas\AppData\Local\Microsoft\PowerToys\FancyZones\`
- Run placement: `node src/index.js place`
- If placement coordinates are wrong, check `editor-parameters.json` for stale DPI values — a reboot fixes it
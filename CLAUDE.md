AGENTS.md

## Workflow
- Закончил фичу — выкати её на Windows: `ssh popstas-pc` + `./data/scripts/deploy-pc.sh`. Здесь проверить можно только тесты и сборку, работает код на той машине.

## Quick reference
- Config (живой, на popstas-pc): `C:\Users\popstas\AppData\Roaming\windows-mqtt\windows11-manager.config.yaml` — первый путь в `resolveConfigPath()`; `~/.config/windows11-manager.config.yaml` там не существует
- Деплой на Windows: `ssh popstas-pc` + `./data/scripts/deploy-pc.sh` (вне git)
- FancyZones data: `C:\Users\popstas\AppData\Local\Microsoft\PowerToys\FancyZones\`
- Run placement: `node src/index.js place`
- If placement coordinates are wrong, check `editor-parameters.json` for stale DPI values — a reboot fixes it
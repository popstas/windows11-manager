# windows11-manager

## Build commands
- Node CLI: `node src <command>` (place, store, restore, clear, reload, open-default, stats, dashboard)
- Tauri build: `cd tauri-app/src-tauri && . "$HOME/.cargo/env" && cargo build`
- No automated tests exist

## Architecture
- Node.js CLI (`src/index.js`) uses commander, delegates to `src/lib/` modules
- Tauri v2 app (`tauri-app/src-tauri/src/lib.rs`) wraps the CLI via `tauri-plugin-shell`
- `run_node_command()` helper in lib.rs for spawning node commands with logging
- Config: copy `config.example.js` to `config.js`; settings in Tauri stored via `tauri-plugin-store`

## Conventions
- Tray menu items call node CLI commands via shell plugin, not direct FFI
- Use `get_project_path(app)` to resolve the node project path from settings
- MQTT/WS lifecycle managed in AppState behind Mutex

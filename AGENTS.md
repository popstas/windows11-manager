# Developer Guide

This repository contains a Node.js tool for managing window placement on Windows 11 using PowerToys FancyZones and the VirtualDesktop11 utility. The codebase is small, but the main logic is in the **src** folder.

## Project layout

- **src/index.js** – command line entry point using `commander`. It wires commands like `place`, `store`, `restore` and `stats` to the functions exported from `src/lib/`.
- **src/lib/** – directory with modularized logic (`placement.js`, `windows.js`, `monitors.js`, `virtual-desktop.js`, etc.).
- **src/helpers/** – helper types (TypeScript) used by the main code.
- **examples/** – small scripts showing how to call the library (e.g. `placeWindows.js`, `swapWindows.js`).
- **config.example.js** – copy this file to `config.js` and customise rules for your environment. Without `config.js` the CLI will fail.
- **vendor/** – patched copy of [node-window-manager](https://github.com/sentialx/node-window-manager) used by the project.
- **VirtualDesktop11.exe** – third party utility required for switching desktops and pinning windows. Only works on Windows.
- **tauri-app/** – Tauri v2 system tray app that wraps the CLI (place windows, store, restore, autoplacer, MQTT). Runs node commands via the `tauri-plugin-shell` shell plugin. All tray menu logic is in `tauri-app/src-tauri/src/lib.rs`.

## Getting started

1. Run `npm install` to install dependencies.
2. Copy `config.example.js` to `config.js` and adjust the window rules and paths.
3. Use `node src <command>` or `npm start -- <command>`.
   - `place` – apply rules and reposition windows.
   - `store` – save currently opened windows.
   - `restore` – reopen stored windows.
   - `clear` – delete stored windows file.
   - `reload` – reload config files.
   - `open-default` – open apps defined in `config.store.default`.
   - `stats` – print window statistics.
   - `dashboard` – print JSON with stats, store, config, and log tail.
4. Look into the `examples` directory for additional usage samples.

There are no automated tests at the moment. Functionality heavily depends on a Windows 11 environment with FancyZones enabled, so many scripts will not work on other platforms.

## Tauri app architecture

- **lib.rs** — main entry point: tray menu, event handlers, settings, MQTT/WS lifecycle.
- **logging.rs** — file logging with `fern`.
- **mqtt.rs** — MQTT client (rumqttc).
- **ws_server.rs** — WebSocket server bridging MQTT commands to node.
- Use `run_node_command(app, &[args], "Label")` helper to spawn node CLI commands from Rust with logging.
- Settings stored via `tauri-plugin-store` in `settings.json` (project_path, MQTT config, etc.).
- Build: `cd tauri-app/src-tauri && . "$HOME/.cargo/env" && cargo build`.

## Key lib exports (src/lib/)

- `src/store.js` exports: `storeWindows`, `restoreWindows`, `openWindows`, `openPaths`, `openStore`, `clearWindows`
- `src/config.js` exports: `getConfig`, `reloadConfigs`, `watchAppliedLayouts`
- `src/placement.js` exports: `placeWindows`, `placeWindowByConfig`

## Next steps

- Study the modules in `src/lib/` – all main features are implemented there.
- Explore `config.example.js` to learn how rules are defined and how FancyZones monitors are referenced.
- Review `examples/*.js` for practical code snippets.


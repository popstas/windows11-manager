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
- **tauri-app/** – Tauri v2 system tray app that wraps the CLI (place windows, autoplacer). Runs `node src place` and `node examples/autoplace-server.js` via the shell plugin.

## Getting started

1. Run `npm install` to install dependencies.
2. Copy `config.example.js` to `config.js` and adjust the window rules and paths.
3. Use `node src <command>` or `npm start -- <command>`.
   - `place` – apply rules and reposition windows.
   - `store` – save currently opened windows.
   - `restore` – reopen stored windows.
   - `stats` – print window statistics.
4. Look into the `examples` directory for additional usage samples.

There are no automated tests at the moment. Functionality heavily depends on a Windows 11 environment with FancyZones enabled, so many scripts will not work on other platforms.

## Next steps

- Study the modules in `src/lib/` – all main features are implemented there.
- Explore `config.example.js` to learn how rules are defined and how FancyZones monitors are referenced.
- Review `examples/*.js` for practical code snippets.


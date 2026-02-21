Rules based manager of windows state for Windows 11: position, desktop, pin.

## Attention
Project is dirty and will not work out of the box.

## Features:
- Place windows by config rules
- Find window by title/path regex
- Use PowerToys FancyZones layouts
- Actions: x, y, width, height, fancyZones monitor/position, pin
- Autoplace new windows after open
- Store/restore opened windows
- Set wallpapers by virtual desktop
- Opened windows stats
- Command line: place, store, restore, stats

Based on [MScholtes/VirtualDesktop CLI tool](https://github.com/MScholtes/VirtualDesktop).

I use it with:

- [windows-mqtt](https://github.com/popstas/windows-mqtt)
- Autohotkey


## Install
- Copy [config.example.js](config.example.js) to config.js
- See [examples](examples)

## Tauri tray app

The **tauri-app** subfolder contains a system tray application that wraps the CLI. It lets you place windows and run the autoplacer without using the terminal.

### What it does
- **Tray menu**: Place Windows, Start/Stop Autoplacer, Settings, Quit
- **Place Windows**: Runs `node src place` in the configured project directory
- **Autoplacer**: Starts or stops `node examples/autoplace-server.js` to automatically place new windows
- **Global hotkey**: Ctrl+Alt+Shift+P triggers "Place Windows"
- **Settings**: Project path, autoplacer interval, run on startup, notifications

### Requirements
- Rust toolchain and C++ build tools (Visual Studio "C++ build tools" workload on Windows)
- Node.js and the main project configured (see [Install](#install))

### Run
```bash
cd tauri-app
npm install
npm run tauri dev
```

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub project_path: String,
    pub autoplacer_interval: u32,
    pub run_on_startup: bool,
    pub show_notifications: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            project_path: "c:/projects/js/windows11-manager".to_string(),
            autoplacer_interval: 0,
            run_on_startup: false,
            show_notifications: false,
        }
    }
}

struct AppState {
    autoplacer_running: bool,
    autoplacer_child: Option<tauri_plugin_shell::process::CommandChild>,
}

struct TrayHolder {
    _tray: tauri::tray::TrayIcon<tauri::Wry>,
}

#[tauri::command]
async fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let store = app
        .store("settings.json")
        .map_err(|e| e.to_string())?;

    let settings = Settings {
        project_path: store
            .get("project_path")
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_default(),
        autoplacer_interval: store
            .get("autoplacer_interval")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        run_on_startup: store
            .get("run_on_startup")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        show_notifications: store
            .get("show_notifications")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    };

    Ok(settings)
}

#[tauri::command]
async fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let store = app
        .store("settings.json")
        .map_err(|e| e.to_string())?;

    store.set("project_path", serde_json::json!(settings.project_path));
    store.set(
        "autoplacer_interval",
        serde_json::json!(settings.autoplacer_interval),
    );
    store.set("run_on_startup", serde_json::json!(settings.run_on_startup));
    store.set(
        "show_notifications",
        serde_json::json!(settings.show_notifications),
    );
    store.save().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn get_dashboard_data(app: tauri::AppHandle) -> Result<String, String> {
    let project_path = get_project_path(&app);
    if project_path.is_empty() {
        return Err("Project path not configured".to_string());
    }

    let shell = app.shell();
    let output = shell
        .command("node")
        .args(["src", "dashboard"])
        .current_dir(&project_path)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Dashboard command failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(stdout.trim().to_string())
}

fn get_project_path(app: &tauri::AppHandle) -> String {
    let store = app.store("settings.json").ok();
    store
        .and_then(|s| s.get("project_path").and_then(|v| v.as_str().map(String::from)))
        .unwrap_or_default()
}

fn place_windows(app: &tauri::AppHandle) {
    let project_path = get_project_path(app);
    if project_path.is_empty() {
        eprintln!("Project path not configured, opening settings");
        open_settings_window(app);
        return;
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        println!("--- Place Windows ---");
        let shell = app_handle.shell();
        let output = shell
            .command("node")
            .args(["src", "place", "--verbose"])
            .current_dir(&project_path)
            .output()
            .await;

        match output {
            Ok(out) => {
                let exit_code = out.status.code().unwrap_or(-1);
                if !out.stdout.is_empty() {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    for line in stdout.lines() {
                        println!("  {}", line);
                    }
                }
                if !out.stderr.is_empty() {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    for line in stderr.lines() {
                        eprintln!("  {}", line);
                    }
                }
                println!("--- Done (exit: {}) ---", exit_code);
            }
            Err(e) => {
                eprintln!("Failed to place windows: {}", e);
                println!("--- Done (error) ---");
            }
        }
    });
}

fn toggle_autoplacer(app: &tauri::AppHandle, state: &State<'_, Mutex<AppState>>) {
    let project_path = get_project_path(app);
    if project_path.is_empty() {
        eprintln!("Project path not configured, opening settings");
        open_settings_window(app);
        return;
    }

    let mut app_state = state.lock().unwrap();

    if app_state.autoplacer_running {
        // Stop autoplacer
        if let Some(child) = app_state.autoplacer_child.take() {
            let _ = child.kill();
        }
        app_state.autoplacer_running = false;
        println!("Autoplacer stopped");
    } else {
        // Start autoplacer
        let shell = app.shell();
        let result = shell
            .command("node")
            .args(["examples/autoplace-server.js"])
            .current_dir(&project_path)
            .spawn();

        match result {
            Ok((_rx, child)) => {
                app_state.autoplacer_child = Some(child);
                app_state.autoplacer_running = true;
                println!("Autoplacer started");
            }
            Err(e) => eprintln!("Failed to start autoplacer: {}", e),
        }
    }

    // Notify frontend about state change
    let _ = app.emit("autoplacer-toggled", app_state.autoplacer_running);
}

fn open_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
        return;
    }

    match tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::App("main.html".into()),
    )
    .title("windows11-manager")
    .inner_size(700.0, 600.0)
    .resizable(true)
    .center()
    .build()
    {
        Ok(_) => {}
        Err(e) => eprintln!("Failed to open main window: {}", e),
    }
}

fn open_settings_window(app: &tauri::AppHandle) {
    // If settings window already exists, focus it
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.set_focus();
        return;
    }

    match tauri::WebviewWindowBuilder::new(
        app,
        "settings",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("windows11-manager Settings")
    .inner_size(480.0, 400.0)
    .resizable(false)
    .center()
    .build()
    {
        Ok(_) => {}
        Err(e) => eprintln!("Failed to open settings window: {}", e),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Mutex::new(AppState {
            autoplacer_running: false,
            autoplacer_child: None,
        }))
        .invoke_handler(tauri::generate_handler![get_settings, save_settings, get_dashboard_data])
        .setup(|app| {
            // Build tray menu
            let place_i = MenuItem::with_id(app, "place", "Place Windows", true, None::<&str>)?;
            let auto_i =
                MenuItem::with_id(app, "autoplacer", "Start Autoplacer", true, None::<&str>)?;
            let settings_i =
                MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
            let exit_i = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;

            let menu = Menu::with_items(app, &[&place_i, &auto_i, &settings_i, &sep, &exit_i])?;

            let tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(move |tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        open_main_window(tray.app_handle());
                    }
                })
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "place" => {
                        place_windows(app);
                    }
                    "autoplacer" => {
                        let state = app.state::<Mutex<AppState>>();
                        toggle_autoplacer(app, &state);

                        // Update menu item text
                        let running = state.lock().unwrap().autoplacer_running;
                        let text = if running {
                            "Stop Autoplacer"
                        } else {
                            "Start Autoplacer"
                        };
                        let _ = auto_i.set_text(text);
                    }
                    "settings" => {
                        open_settings_window(app);
                    }
                    "exit" => {
                        // Kill autoplacer if running
                        let state = app.state::<Mutex<AppState>>();
                        let mut s = state.lock().unwrap();
                        if let Some(child) = s.autoplacer_child.take() {
                            let _ = child.kill();
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Retain tray reference so it persists for app lifetime
            app.manage(TrayHolder { _tray: tray });

            // Register global hotkey: Ctrl+Alt+Shift+P
            use tauri_plugin_global_shortcut::ShortcutState;

            if let Err(e) = app.global_shortcut().on_shortcut(
                "Ctrl+Alt+Shift+P",
                move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        eprintln!("Hotkey Ctrl+Alt+Shift+P pressed");
                        place_windows(app);
                    }
                },
            ) {
                eprintln!("Could not register hotkey Ctrl+Alt+Shift+P: {} (already in use?)", e);
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Kill autoplacer on exit
                let state = app.state::<Mutex<AppState>>();
                let mut s = state.lock().unwrap();
                if let Some(child) = s.autoplacer_child.take() {
                    let _ = child.kill();
                }
            }
        });
}

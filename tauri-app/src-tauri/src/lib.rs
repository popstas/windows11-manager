use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
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
            project_path: String::new(),
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

fn get_project_path(app: &tauri::AppHandle) -> String {
    let store = app.store("settings.json").ok();
    store
        .and_then(|s| s.get("project_path").and_then(|v| v.as_str().map(String::from)))
        .unwrap_or_default()
}

fn place_windows(app: &tauri::AppHandle) {
    let project_path = get_project_path(app);
    if project_path.is_empty() {
        eprintln!("Project path not configured");
        return;
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let shell = app_handle.shell();
        let output = shell
            .command("node")
            .args(["src", "place"])
            .current_dir(&project_path)
            .output()
            .await;

        match output {
            Ok(out) => {
                if !out.stdout.is_empty() {
                    println!("place: {}", String::from_utf8_lossy(&out.stdout));
                }
                if !out.stderr.is_empty() {
                    eprintln!("place stderr: {}", String::from_utf8_lossy(&out.stderr));
                }
            }
            Err(e) => eprintln!("Failed to place windows: {}", e),
        }
    });
}

fn toggle_autoplacer(app: &tauri::AppHandle, state: &State<'_, Mutex<AppState>>) {
    let project_path = get_project_path(app);
    if project_path.is_empty() {
        eprintln!("Project path not configured");
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

fn open_settings_window(app: &tauri::AppHandle) {
    // If settings window already exists, focus it
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.set_focus();
        return;
    }

    let _window = tauri::WebviewWindowBuilder::new(
        app,
        "settings",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("windows11-manager Settings")
    .inner_size(480.0, 400.0)
    .resizable(false)
    .center()
    .build();
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
        .invoke_handler(tauri::generate_handler![get_settings, save_settings])
        .setup(|app| {
            // Build tray menu
            let place_i = MenuItem::with_id(app, "place", "Place Windows", true, None::<&str>)?;
            let auto_i =
                MenuItem::with_id(app, "autoplacer", "Start Autoplacer", true, None::<&str>)?;
            let settings_i =
                MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&place_i, &auto_i, &settings_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
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
                    "quit" => {
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

            // Register global hotkey: Ctrl+Alt+Shift+P
            use tauri_plugin_global_shortcut::ShortcutState;

            app.global_shortcut().on_shortcut(
                "Ctrl+Alt+Shift+P",
                move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        place_windows(app);
                    }
                },
            )?;

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

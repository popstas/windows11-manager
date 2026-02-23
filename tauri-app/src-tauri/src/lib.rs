mod mqtt;
mod ws_server;

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
    pub mqtt_enabled: bool,
    pub mqtt_host: String,
    pub mqtt_port: u16,
    pub mqtt_username: String,
    pub mqtt_password: String,
    pub mqtt_topic: String,
    pub ws_port: u16,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            project_path: "c:/projects/js/windows11-manager".to_string(),
            autoplacer_interval: 0,
            run_on_startup: false,
            show_notifications: false,
            mqtt_enabled: false,
            mqtt_host: String::new(),
            mqtt_port: 1883,
            mqtt_username: String::new(),
            mqtt_password: String::new(),
            mqtt_topic: String::new(),
            ws_port: 9721,
        }
    }
}

struct AppState {
    autoplacer_running: bool,
    autoplacer_child: Option<tauri_plugin_shell::process::CommandChild>,
    mqtt_running: bool,
    mqtt_handle: Option<mqtt::MqttHandle>,
    ws_handle: Option<ws_server::WsServerHandle>,
    ws_client_child: Option<tauri_plugin_shell::process::CommandChild>,
}

struct TrayHolder {
    _tray: tauri::tray::TrayIcon<tauri::Wry>,
}

#[tauri::command]
async fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let store = app
        .store("settings.json")
        .map_err(|e| e.to_string())?;

    let defaults = Settings::default();

    let settings = Settings {
        project_path: store
            .get("project_path")
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or(defaults.project_path),
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
        mqtt_enabled: store
            .get("mqtt_enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        mqtt_host: store
            .get("mqtt_host")
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or(defaults.mqtt_host),
        mqtt_port: store
            .get("mqtt_port")
            .and_then(|v| v.as_u64())
            .unwrap_or(defaults.mqtt_port as u64) as u16,
        mqtt_username: store
            .get("mqtt_username")
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or(defaults.mqtt_username),
        mqtt_password: store
            .get("mqtt_password")
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or(defaults.mqtt_password),
        mqtt_topic: store
            .get("mqtt_topic")
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or(defaults.mqtt_topic),
        ws_port: store
            .get("ws_port")
            .and_then(|v| v.as_u64())
            .unwrap_or(defaults.ws_port as u64) as u16,
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
    store.set("mqtt_enabled", serde_json::json!(settings.mqtt_enabled));
    store.set("mqtt_host", serde_json::json!(settings.mqtt_host));
    store.set("mqtt_port", serde_json::json!(settings.mqtt_port));
    store.set("mqtt_username", serde_json::json!(settings.mqtt_username));
    store.set("mqtt_password", serde_json::json!(settings.mqtt_password));
    store.set("mqtt_topic", serde_json::json!(settings.mqtt_topic));
    store.set("ws_port", serde_json::json!(settings.ws_port));
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
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        shell
            .command("node")
            .args(["src", "dashboard"])
            .current_dir(&project_path)
            .output(),
    )
    .await
    .map_err(|_| "Dashboard command timed out after 10s".to_string())?
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

fn load_settings_from_store(app: &tauri::AppHandle) -> Settings {
    let store = match app.store("settings.json") {
        Ok(s) => s,
        Err(_) => return Settings::default(),
    };
    let defaults = Settings::default();
    Settings {
        project_path: store.get("project_path").and_then(|v| v.as_str().map(String::from)).unwrap_or(defaults.project_path),
        autoplacer_interval: store.get("autoplacer_interval").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        run_on_startup: store.get("run_on_startup").and_then(|v| v.as_bool()).unwrap_or(false),
        show_notifications: store.get("show_notifications").and_then(|v| v.as_bool()).unwrap_or(false),
        mqtt_enabled: store.get("mqtt_enabled").and_then(|v| v.as_bool()).unwrap_or(false),
        mqtt_host: store.get("mqtt_host").and_then(|v| v.as_str().map(String::from)).unwrap_or(defaults.mqtt_host),
        mqtt_port: store.get("mqtt_port").and_then(|v| v.as_u64()).unwrap_or(defaults.mqtt_port as u64) as u16,
        mqtt_username: store.get("mqtt_username").and_then(|v| v.as_str().map(String::from)).unwrap_or(defaults.mqtt_username),
        mqtt_password: store.get("mqtt_password").and_then(|v| v.as_str().map(String::from)).unwrap_or(defaults.mqtt_password),
        mqtt_topic: store.get("mqtt_topic").and_then(|v| v.as_str().map(String::from)).unwrap_or(defaults.mqtt_topic),
        ws_port: store.get("ws_port").and_then(|v| v.as_u64()).unwrap_or(defaults.ws_port as u64) as u16,
    }
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

fn start_mqtt_service(app: &tauri::AppHandle, state: &State<'_, Mutex<AppState>>) {
    let settings = load_settings_from_store(app);
    if settings.mqtt_host.is_empty() || settings.mqtt_topic.is_empty() {
        eprintln!("MQTT host or topic not configured");
        return;
    }

    let project_path = get_project_path(app);
    if project_path.is_empty() {
        eprintln!("Project path not configured, opening settings");
        open_settings_window(app);
        return;
    }

    let (mqtt_handle, mqtt_future) = mqtt::start_mqtt(
        settings.mqtt_host,
        settings.mqtt_port,
        settings.mqtt_username,
        settings.mqtt_password,
        settings.mqtt_topic,
    );
    tauri::async_runtime::spawn(mqtt_future);

    let (ws_handle, ws_future) =
        ws_server::start_ws_server(settings.ws_port, mqtt_handle.command_tx.clone());
    tauri::async_runtime::spawn(ws_future);

    // Spawn Node.js WS client
    let shell = app.shell();
    let ws_client = shell
        .command("node")
        .args(["src/ws-client.js", &settings.ws_port.to_string()])
        .current_dir(&project_path)
        .spawn();

    let mut app_state = state.lock().unwrap();

    match ws_client {
        Ok((_rx, child)) => {
            app_state.ws_client_child = Some(child);
        }
        Err(e) => eprintln!("Failed to start WS client: {}", e),
    }

    app_state.mqtt_handle = Some(mqtt_handle);
    app_state.ws_handle = Some(ws_handle);
    app_state.mqtt_running = true;
    println!("MQTT service started");
}

fn stop_mqtt_service(state: &State<'_, Mutex<AppState>>) {
    let mut app_state = state.lock().unwrap();
    stop_mqtt_state(&mut app_state);
}

fn stop_mqtt_state(app_state: &mut AppState) {
    if let Some(child) = app_state.ws_client_child.take() {
        let _ = child.kill();
    }
    if let Some(mut ws) = app_state.ws_handle.take() {
        ws.stop();
    }
    if let Some(mut mq) = app_state.mqtt_handle.take() {
        mq.stop();
    }
    app_state.mqtt_running = false;
    println!("MQTT service stopped");
}

fn toggle_mqtt(app: &tauri::AppHandle, state: &State<'_, Mutex<AppState>>) {
    let running = state.lock().unwrap().mqtt_running;
    if running {
        stop_mqtt_service(state);
    } else {
        start_mqtt_service(app, state);
    }
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
    .inner_size(480.0, 650.0)
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
            mqtt_running: false,
            mqtt_handle: None,
            ws_handle: None,
            ws_client_child: None,
        }))
        .invoke_handler(tauri::generate_handler![get_settings, save_settings, get_dashboard_data])
        .setup(|app| {
            // Build tray menu
            let place_i = MenuItem::with_id(app, "place", "Place Windows", true, None::<&str>)?;
            let auto_i =
                MenuItem::with_id(app, "autoplacer", "Start Autoplacer", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let mqtt_status_i =
                MenuItem::with_id(app, "mqtt_status", "MQTT: Off", false, None::<&str>)?;
            let mqtt_toggle_i =
                MenuItem::with_id(app, "mqtt_toggle", "Start MQTT", true, None::<&str>)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let settings_i =
                MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
            let exit_i = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[
                    &place_i,
                    &auto_i,
                    &sep1,
                    &mqtt_status_i,
                    &mqtt_toggle_i,
                    &sep2,
                    &settings_i,
                    &exit_i,
                ],
            )?;

            // Clone menu items for use outside the on_menu_event closure
            let mqtt_status_i_poll = mqtt_status_i.clone();
            let mqtt_status_i_auto = mqtt_status_i.clone();
            let mqtt_toggle_i_auto = mqtt_toggle_i.clone();

            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
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
                    "mqtt_toggle" => {
                        let state = app.state::<Mutex<AppState>>();
                        toggle_mqtt(app, &state);

                        let running = state.lock().unwrap().mqtt_running;
                        let _ = mqtt_toggle_i.set_text(if running {
                            "Stop MQTT"
                        } else {
                            "Start MQTT"
                        });
                        let _ = mqtt_status_i.set_text(if running {
                            "MQTT: Starting..."
                        } else {
                            "MQTT: Off"
                        });
                    }
                    "settings" => {
                        open_settings_window(app);
                    }
                    "exit" => {
                        // Kill all child processes
                        let state = app.state::<Mutex<AppState>>();
                        let mut s = state.lock().unwrap();
                        if let Some(child) = s.autoplacer_child.take() {
                            let _ = child.kill();
                        }
                        stop_mqtt_state(&mut s);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Retain tray reference so it persists for app lifetime
            app.manage(TrayHolder { _tray: tray });

            // Auto-start MQTT if enabled
            let settings = load_settings_from_store(&app.handle());
            if settings.mqtt_enabled {
                let state = app.state::<Mutex<AppState>>();
                start_mqtt_service(&app.handle(), &state);
                // Update menu texts for auto-started MQTT
                let _ = mqtt_toggle_i_auto.set_text("Stop MQTT");
                let _ = mqtt_status_i_auto.set_text("MQTT: Starting...");
            }

            // Spawn background task to poll MQTT status every 2s
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    let status_arc = {
                        let state = app_handle.state::<Mutex<AppState>>();
                        let s = state.lock().unwrap();
                        s.mqtt_handle.as_ref().map(|mq| mq.status.clone())
                    }; // MutexGuard dropped here before any await
                    if let Some(arc) = status_arc {
                        let status = arc.lock().await;
                        let _ = mqtt_status_i_poll.set_text(status.label());
                    }
                }
            });

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
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}

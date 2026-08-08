mod children;
mod logging;
mod updater;

use children::{next_restart_attempt, pump_output, restart_delay_secs, ChildKind};
use log::{error, info, warn};
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
    pub claude_wt_enabled: bool,
    pub restore_on_start: bool,
    pub store_before_exit: bool,
    pub store_interval: u32,
    pub store_match_list: Vec<String>,
    pub timeout_before_open: u32,
    pub update_check_interval: String,
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
            // По умолчанию включено: на демоне claude-wt держится вся цепочка
            // (панель openHASP и пикер сессий), и выключенным он полезен только
            // при отладке.
            claude_wt_enabled: true,
            restore_on_start: true,
            store_before_exit: true,
            store_interval: 300,
            store_match_list: Vec::new(),
            timeout_before_open: 5,
            update_check_interval: "launch".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_default_values() {
        let s = Settings::default();
        assert_eq!(s.mqtt_port, 1883);
        assert!(!s.mqtt_enabled);
        assert!(s.claude_wt_enabled);
        assert!(s.restore_on_start);
        assert!(s.store_before_exit);
        assert_eq!(s.autoplacer_interval, 0);
        assert_eq!(s.store_interval, 300);
        assert!(s.store_match_list.is_empty());
        assert_eq!(s.timeout_before_open, 5);
        assert_eq!(s.update_check_interval, "launch");
    }
}

struct AppState {
    autoplacer_running: bool,
    autoplacer_child: Option<tauri_plugin_shell::process::CommandChild>,
    /// Номер поколения ребёнка. Событие о смерти приходит асинхронно и вполне
    /// может застать уже следующий, только что поднятый процесс — тогда оно
    /// погасило бы статус живого ребёнка. Обработчик сверяет поколение и
    /// молча выбрасывает опоздавшее событие.
    autoplacer_generation: u64,
    claude_wt_running: bool,
    claude_wt_child: Option<tauri_plugin_shell::process::CommandChild>,
    claude_wt_generation: u64,
    /// Демон должен работать. Отличает падение от «оператор выключил руками»:
    /// первое поднимаем заново, второе — нет.
    claude_wt_desired: bool,
    /// Сколько раз подряд демон не смог прожить [`children::HEALTHY_UPTIME_SECS`].
    claude_wt_restart_attempts: u32,
    mqtt_running: bool,
    mqtt_child: Option<tauri_plugin_shell::process::CommandChild>,
    mqtt_generation: u64,
    /// Служба должна работать. Ровно та же роль, что и у `claude_wt_desired`:
    /// когда-то этот ребёнок был просто клиентом MQTT, и его смерть стоила
    /// панели в Home Assistant. Теперь в нём же живут экспорт сессий,
    /// статистика окон, автоматическая расстановка и сторож демона claude-wt —
    /// то есть незамеченное падение уносит половину надзора за машиной.
    mqtt_desired: bool,
    /// Сколько раз подряд служба не смогла прожить [`children::HEALTHY_UPTIME_SECS`].
    mqtt_restart_attempts: u32,
    update_download_url: Option<String>,
}

impl AppState {
    fn new() -> Self {
        Self {
            autoplacer_running: false,
            autoplacer_child: None,
            autoplacer_generation: 0,
            claude_wt_running: false,
            claude_wt_child: None,
            claude_wt_generation: 0,
            claude_wt_desired: false,
            claude_wt_restart_attempts: 0,
            mqtt_running: false,
            mqtt_child: None,
            mqtt_generation: 0,
            mqtt_desired: false,
            mqtt_restart_attempts: 0,
            update_download_url: None,
        }
    }
}

struct TrayHolder {
    _tray: tauri::tray::TrayIcon<tauri::Wry>,
}

/// Пункты трея, которым нужно менять подпись не только из обработчика меню:
/// ребёнок умирает в фоновой задаче, и подпись «running» обязана погаснуть
/// именно оттуда.
struct TrayMenuItems {
    autoplacer: MenuItem<tauri::Wry>,
    claude_wt: MenuItem<tauri::Wry>,
    mqtt_status: MenuItem<tauri::Wry>,
    mqtt_toggle: MenuItem<tauri::Wry>,
}

fn update_tray_label(app: &tauri::AppHandle, kind: ChildKind, running: bool) {
    let Some(items) = app.try_state::<TrayMenuItems>() else {
        return;
    };
    match kind {
        ChildKind::Autoplacer => {
            let _ = items.autoplacer.set_text(if running {
                "Stop Autoplacer"
            } else {
                "Start Autoplacer"
            });
        }
        ChildKind::ClaudeWt => {
            let _ = items.claude_wt.set_text(if running {
                "Stop claude-wt"
            } else {
                "Start claude-wt"
            });
        }
        ChildKind::Mqtt => {
            let _ = items.mqtt_toggle.set_text(if running {
                "Stop MQTT"
            } else {
                "Start MQTT"
            });
            let _ = items.mqtt_status.set_text(if running {
                "MQTT: running"
            } else {
                "MQTT: stopped"
            });
        }
    }
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
        claude_wt_enabled: store
            .get("claude_wt_enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(defaults.claude_wt_enabled),
        restore_on_start: store
            .get("restore_on_start")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        store_before_exit: store
            .get("store_before_exit")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        store_interval: store
            .get("store_interval")
            .and_then(|v| v.as_u64())
            .unwrap_or(300) as u32,
        store_match_list: store
            .get("store_match_list")
            .and_then(|v| {
                v.as_array().map(|arr| {
                    arr.iter()
                        .filter_map(|item| item.as_str().map(String::from))
                        .collect::<Vec<String>>()
                })
            })
            .unwrap_or_default(),
        timeout_before_open: store
            .get("timeout_before_open")
            .and_then(|v| v.as_u64())
            .unwrap_or(5) as u32,
        update_check_interval: store
            .get("update_check_interval")
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or(defaults.update_check_interval),
    };

    Ok(settings)
}

#[tauri::command]
async fn get_app_version(app: tauri::AppHandle) -> Result<String, String> {
    Ok(app.package_info().version.to_string())
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
    store.set(
        "claude_wt_enabled",
        serde_json::json!(settings.claude_wt_enabled),
    );
    store.set("restore_on_start", serde_json::json!(settings.restore_on_start));
    store.set("store_before_exit", serde_json::json!(settings.store_before_exit));
    store.set("store_interval", serde_json::json!(settings.store_interval));
    store.set(
        "store_match_list",
        serde_json::json!(settings.store_match_list),
    );
    store.set("timeout_before_open", serde_json::json!(settings.timeout_before_open));
    store.set("update_check_interval", serde_json::json!(settings.update_check_interval));
    store.save().map_err(|e| e.to_string())?;

    // Write store-match-list.json to project dir so Node can read it
    let project_path = store
        .get("project_path")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();
    if !project_path.is_empty() {
        let data_dir = std::path::Path::new(&project_path).join("data");
        let _ = std::fs::create_dir_all(&data_dir);
        let json_path = data_dir.join("store-match-list.json");
        let json = serde_json::to_string(&settings.store_match_list).unwrap_or_default();
        if let Err(e) = std::fs::write(&json_path, &json) {
            error!("Failed to write store-match-list.json: {}", e);
        }
    }

    Ok(())
}

#[tauri::command]
async fn save_store_match_list(app: tauri::AppHandle, list: Vec<String>) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.set("store_match_list", serde_json::json!(list));
    store.save().map_err(|e| e.to_string())?;

    let project_path = store
        .get("project_path")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();
    if !project_path.is_empty() {
        let data_dir = std::path::Path::new(&project_path).join("data");
        let _ = std::fs::create_dir_all(&data_dir);
        let json_path = data_dir.join("store-match-list.json");
        let json = serde_json::to_string(&list).unwrap_or_default();
        if let Err(e) = std::fs::write(&json_path, &json) {
            error!("Failed to write store-match-list.json: {}", e);
        }
    }
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
        claude_wt_enabled: store.get("claude_wt_enabled").and_then(|v| v.as_bool()).unwrap_or(defaults.claude_wt_enabled),
        restore_on_start: store.get("restore_on_start").and_then(|v| v.as_bool()).unwrap_or(true),
        store_before_exit: store.get("store_before_exit").and_then(|v| v.as_bool()).unwrap_or(true),
        store_interval: store.get("store_interval").and_then(|v| v.as_u64()).unwrap_or(300) as u32,
        store_match_list: store.get("store_match_list").and_then(|v| v.as_array().map(|arr| arr.iter().filter_map(|item| item.as_str().map(String::from)).collect::<Vec<String>>())).unwrap_or_default(),
        timeout_before_open: store.get("timeout_before_open").and_then(|v| v.as_u64()).unwrap_or(5) as u32,
        update_check_interval: store.get("update_check_interval").and_then(|v| v.as_str().map(String::from)).unwrap_or(defaults.update_check_interval),
    }
}

fn run_node_command(app: &tauri::AppHandle, args: &[&str], label: &str) {
    let project_path = get_project_path(app);
    if project_path.is_empty() {
        warn!("Project path not configured");
        return;
    }
    let app_handle = app.clone();
    let label = label.to_string();
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    tauri::async_runtime::spawn(async move {
        info!("--- {} ---", label);
        let shell = app_handle.shell();
        let output = shell
            .command("node")
            .args(&args)
            .current_dir(&project_path)
            .output()
            .await;

        match output {
            Ok(out) => {
                let exit_code = out.status.code().unwrap_or(-1);
                if !out.stdout.is_empty() {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    // Show summary line prominently first
                    for line in stdout.lines() {
                        if line.contains("placeWindows:") {
                            let summary = line.splitn(2, "placeWindows:").last().unwrap_or(line);
                            info!("--- placeWindows:{} ---", summary);
                        }
                    }
                    // Then show all verbose output
                    for line in stdout.lines() {
                        info!("  {}", line);
                    }
                }
                if !out.stderr.is_empty() {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    for line in stderr.lines() {
                        warn!("  {}", line);
                    }
                }
                info!("--- Done (exit: {}) ---", exit_code);
            }
            Err(e) => {
                error!("Failed to run {}: {}", label, e);
                info!("--- Done (error) ---");
            }
        }
    });
}

fn place_windows(app: &tauri::AppHandle) {
    let project_path = get_project_path(app);
    if project_path.is_empty() {
        warn!("Project path not configured, opening settings");
        open_settings_window(app);
        return;
    }
    run_node_command(app, &["src", "place", "--verbose"], "Place Windows");
}

/// Ребёнок умер. Гасит статус, пишет код возврата и — для демона claude-wt —
/// заводит подъём с откатом.
///
/// Зовётся из фоновой задачи, вычитывающей поток событий, поэтому берёт мьютекс
/// сам и отпускает его до того, как трогать трей.
fn on_child_exit(
    app: &tauri::AppHandle,
    kind: ChildKind,
    generation: u64,
    reason: String,
    uptime_secs: u64,
) {
    let state = app.state::<Mutex<AppState>>();
    let mut s = state.lock().unwrap();

    let current = match kind {
        ChildKind::Autoplacer => s.autoplacer_generation,
        ChildKind::ClaudeWt => s.claude_wt_generation,
        ChildKind::Mqtt => s.mqtt_generation,
    };
    if current != generation {
        // Опоздавшее событие от процесса, который уже сменили или остановили
        // руками. Гасить по нему статус нельзя — он относится к живому ребёнку.
        info!(
            "{}: previous instance exited with {} after {}s",
            kind.label(),
            reason,
            uptime_secs
        );
        return;
    }

    match kind {
        ChildKind::Autoplacer => {
            s.autoplacer_child = None;
            s.autoplacer_running = false;
        }
        ChildKind::ClaudeWt => {
            s.claude_wt_child = None;
            s.claude_wt_running = false;
        }
        ChildKind::Mqtt => {
            s.mqtt_child = None;
            s.mqtt_running = false;
        }
    }
    warn!(
        "{} exited with {} after {}s",
        kind.label(),
        reason,
        uptime_secs
    );

    // Поднимаем ребёнка, только если его не выключил оператор. Убит он при этом
    // снаружи (в том числе node-стороной, заметившей молчание) или упал сам —
    // разницы нет, для нас это одинаковое «процесса больше нет».
    let delay = match kind {
        ChildKind::ClaudeWt if s.claude_wt_desired => {
            let attempt = next_restart_attempt(s.claude_wt_restart_attempts, uptime_secs);
            s.claude_wt_restart_attempts = attempt;
            Some(attempt)
        }
        ChildKind::Mqtt if s.mqtt_desired => {
            let attempt = next_restart_attempt(s.mqtt_restart_attempts, uptime_secs);
            s.mqtt_restart_attempts = attempt;
            Some(attempt)
        }
        _ => None,
    }
    .map(|attempt| {
        let delay = restart_delay_secs(attempt);
        warn!(
            "{}: restarting in {}s after exit with {} (attempt {})",
            kind.label(),
            delay,
            reason,
            attempt
        );
        delay
    });
    drop(s);

    update_tray_label(app, kind, false);
    match kind {
        ChildKind::Autoplacer => {
            let _ = app.emit("autoplacer-toggled", false);
        }
        ChildKind::ClaudeWt => {
            let _ = app.emit("claude-wt-toggled", false);
        }
        ChildKind::Mqtt => {}
    }
    if let Some(delay) = delay {
        match kind {
            ChildKind::ClaudeWt => schedule_claude_wt_restart(app, delay),
            ChildKind::Mqtt => schedule_mqtt_restart(app, delay),
            ChildKind::Autoplacer => {}
        }
    }
}

/// Подъём демона через `delay_secs`. Перед подъёмом ещё раз спрашивает
/// состояние: за время паузы оператор мог и выключить демона, и поднять руками.
fn schedule_claude_wt_restart(app: &tauri::AppHandle, delay_secs: u64) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(delay_secs)).await;
        let running = {
            let state = app.state::<Mutex<AppState>>();
            let mut s = state.lock().unwrap();
            if !s.claude_wt_desired || s.claude_wt_running {
                return;
            }
            start_claude_wt_locked(&app, &mut s);
            s.claude_wt_running
        };
        update_tray_label(&app, ChildKind::ClaudeWt, running);
    });
}

/// Запуск демона при уже взятом мьютексе.
///
/// Неудача самого `spawn` (нет node в PATH, кривой путь проекта) — это тот же
/// случай, что и мгновенное падение: попытка засчитывается, следующая уезжает
/// по откату. Иначе цикл «не смог запустить → пробуем снова» крутился бы без
/// паузы и залил бы лог.
fn start_claude_wt_locked(app: &tauri::AppHandle, s: &mut AppState) {
    let project_path = get_project_path(app);
    if project_path.is_empty() {
        warn!("Project path not configured");
        return;
    }
    s.claude_wt_desired = true;

    let shell = app.shell();
    let result = shell
        .command("node")
        .args(["src/index.js", "claude-wt", "watch"])
        .current_dir(&project_path)
        .spawn();

    match result {
        Ok((rx, child)) => {
            s.claude_wt_generation += 1;
            let generation = s.claude_wt_generation;
            s.claude_wt_child = Some(child);
            s.claude_wt_running = true;
            let app_handle = app.clone();
            pump_output(ChildKind::ClaudeWt, rx, move |reason, uptime| {
                on_child_exit(&app_handle, ChildKind::ClaudeWt, generation, reason, uptime);
            });
            info!("claude-wt started");
        }
        Err(e) => {
            s.claude_wt_running = false;
            let attempt = next_restart_attempt(s.claude_wt_restart_attempts, 0);
            s.claude_wt_restart_attempts = attempt;
            let delay = restart_delay_secs(attempt);
            error!(
                "Failed to start claude-wt: {} (retrying in {}s, attempt {})",
                e, delay, attempt
            );
            schedule_claude_wt_restart(app, delay);
        }
    }
}

/// Остановка демона по воле оператора: подъём после неё не нужен.
fn stop_claude_wt_locked(s: &mut AppState) {
    s.claude_wt_desired = false;
    s.claude_wt_restart_attempts = 0;
    // Смена поколения: событие о смерти убитого процесса придёт позже и уже не
    // будет относиться к текущему состоянию.
    s.claude_wt_generation += 1;
    if let Some(child) = s.claude_wt_child.take() {
        let _ = child.kill();
    }
    if s.claude_wt_running {
        info!("claude-wt stopped");
    }
    s.claude_wt_running = false;
}

fn toggle_autoplacer(app: &tauri::AppHandle, state: &State<'_, Mutex<AppState>>) {
    let project_path = get_project_path(app);
    if project_path.is_empty() {
        warn!("Project path not configured, opening settings");
        open_settings_window(app);
        return;
    }

    let mut app_state = state.lock().unwrap();

    if app_state.autoplacer_running {
        // Stop autoplacer
        app_state.autoplacer_generation += 1;
        if let Some(child) = app_state.autoplacer_child.take() {
            let _ = child.kill();
        }
        app_state.autoplacer_running = false;
        info!("Autoplacer stopped");
    } else {
        // Start autoplacer
        let shell = app.shell();
        let result = shell
            .command("node")
            .args(["examples/autoplace-server.js"])
            .current_dir(&project_path)
            .spawn();

        match result {
            Ok((rx, child)) => {
                app_state.autoplacer_generation += 1;
                let generation = app_state.autoplacer_generation;
                app_state.autoplacer_child = Some(child);
                app_state.autoplacer_running = true;
                let app_handle = app.clone();
                pump_output(ChildKind::Autoplacer, rx, move |reason, uptime| {
                    on_child_exit(
                        &app_handle,
                        ChildKind::Autoplacer,
                        generation,
                        reason,
                        uptime,
                    );
                });
                info!("Autoplacer started");
            }
            Err(e) => error!("Failed to start autoplacer: {}", e),
        }
    }

    let running = app_state.autoplacer_running;
    drop(app_state);

    update_tray_label(app, ChildKind::Autoplacer, running);
    // Notify frontend about state change
    let _ = app.emit("autoplacer-toggled", running);
}

fn toggle_claude_wt(app: &tauri::AppHandle, state: &State<'_, Mutex<AppState>>) {
    let project_path = get_project_path(app);
    if project_path.is_empty() {
        warn!("Project path not configured, opening settings");
        open_settings_window(app);
        return;
    }

    let mut app_state = state.lock().unwrap();
    if app_state.claude_wt_running {
        stop_claude_wt_locked(&mut app_state);
    } else {
        start_claude_wt_locked(app, &mut app_state);
    }
    let running = app_state.claude_wt_running;
    drop(app_state);

    update_tray_label(app, ChildKind::ClaudeWt, running);
    let _ = app.emit("claude-wt-toggled", running);
}

fn start_mqtt_service(app: &tauri::AppHandle, state: &State<'_, Mutex<AppState>>) {
    let mut app_state = state.lock().unwrap();
    start_mqtt_locked(app, &mut app_state);
}

/// Подъём службы MQTT через `delay_secs`. Как и у демона, перед подъёмом ещё раз
/// спрашивает состояние: за время паузы оператор мог и выключить службу из трея,
/// и поднять её руками.
fn schedule_mqtt_restart(app: &tauri::AppHandle, delay_secs: u64) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(delay_secs)).await;
        let running = {
            let state = app.state::<Mutex<AppState>>();
            let mut s = state.lock().unwrap();
            if !s.mqtt_desired || s.mqtt_running {
                return;
            }
            start_mqtt_locked(&app, &mut s);
            s.mqtt_running
        };
        update_tray_label(&app, ChildKind::Mqtt, running);
    });
}

/// Запуск службы MQTT при уже взятом мьютексе.
///
/// Как и у демона claude-wt, неудача самого `spawn` (нет node в PATH, кривой
/// путь проекта) считается попыткой: следующая уезжает по откату, иначе цикл
/// «не смог запустить → пробуем снова» крутился бы без паузы.
fn start_mqtt_locked(app: &tauri::AppHandle, s: &mut AppState) {
    let settings = load_settings_from_store(app);
    if settings.mqtt_host.is_empty() || settings.mqtt_topic.is_empty() {
        warn!("MQTT host or topic not configured");
        return;
    }

    let project_path = get_project_path(app);
    if project_path.is_empty() {
        warn!("Project path not configured, opening settings");
        open_settings_window(app);
        return;
    }

    // Ставится после проверок настроек: без хоста, темы или пути проекта поднимать
    // нечего, и откат крутился бы вокруг заведомо невозможного запуска.
    s.mqtt_desired = true;

    // Spawn the Node.js MQTT service. Credentials go through the environment,
    // never argv, since argv is world-readable in the process list.
    let shell = app.shell();
    let mqtt_child = shell
        .command("node")
        .args(["src/index.js", "mqtt"])
        .current_dir(&project_path)
        .env("W11M_MQTT_HOST", settings.mqtt_host)
        .env("W11M_MQTT_PORT", settings.mqtt_port.to_string())
        .env("W11M_MQTT_USER", settings.mqtt_username)
        .env("W11M_MQTT_PASS", settings.mqtt_password)
        .env("W11M_MQTT_BASE", settings.mqtt_topic)
        .spawn();

    match mqtt_child {
        Ok((rx, child)) => {
            s.mqtt_generation += 1;
            let generation = s.mqtt_generation;
            s.mqtt_child = Some(child);
            s.mqtt_running = true;
            let app_handle = app.clone();
            pump_output(ChildKind::Mqtt, rx, move |reason, uptime| {
                on_child_exit(&app_handle, ChildKind::Mqtt, generation, reason, uptime);
            });
            info!("MQTT service started");
        }
        Err(e) => {
            s.mqtt_running = false;
            let attempt = next_restart_attempt(s.mqtt_restart_attempts, 0);
            s.mqtt_restart_attempts = attempt;
            let delay = restart_delay_secs(attempt);
            error!(
                "Failed to start MQTT service: {} (retrying in {}s, attempt {})",
                e, delay, attempt
            );
            schedule_mqtt_restart(app, delay);
        }
    }
}

fn stop_mqtt_service(state: &State<'_, Mutex<AppState>>) {
    let mut app_state = state.lock().unwrap();
    stop_mqtt_state(&mut app_state);
}

/// Остановка службы по воле оператора (или на выходе из приложения): подъём
/// после неё не нужен, и «Stop MQTT» в трее обязан значить именно stop.
fn stop_mqtt_state(app_state: &mut AppState) {
    app_state.mqtt_desired = false;
    app_state.mqtt_restart_attempts = 0;
    // Смена поколения: событие о смерти убитого процесса придёт позже и уже не
    // будет относиться к текущему состоянию.
    app_state.mqtt_generation += 1;
    if let Some(child) = app_state.mqtt_child.take() {
        let _ = child.kill();
    }
    app_state.mqtt_running = false;
    info!("MQTT service stopped");
}

fn toggle_mqtt(app: &tauri::AppHandle, state: &State<'_, Mutex<AppState>>) {
    let running = state.lock().unwrap().mqtt_running;
    if running {
        stop_mqtt_service(state);
    } else {
        start_mqtt_service(app, state);
    }
    let running = state.lock().unwrap().mqtt_running;
    update_tray_label(app, ChildKind::Mqtt, running);
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
        Err(e) => error!("Failed to open main window: {}", e),
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
    .inner_size(480.0, 780.0)
    .resizable(false)
    .center()
    .build()
    {
        Ok(_) => {}
        Err(e) => error!("Failed to open settings window: {}", e),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Mutex::new(AppState::new()))
        .invoke_handler(tauri::generate_handler![get_settings, save_settings, get_dashboard_data, get_app_version, save_store_match_list])
        .setup(|app| {
            let project_path = get_project_path(app.handle());
            logging::init(&project_path);

            // Build tray menu
            let current_version = app.package_info().version.to_string();
            let version_info_i = MenuItem::with_id(app, "version_info", format!("Current: v{}", current_version), false, None::<&str>)?;
            let download_update_i = MenuItem::with_id(app, "download_update", "Check for updates...", false, None::<&str>)?;
            let sep_update = PredefinedMenuItem::separator(app)?;
            let place_i = MenuItem::with_id(app, "place", "Place Windows", true, None::<&str>)?;
            let store_i =
                MenuItem::with_id(app, "store", "Store Windows", true, None::<&str>)?;
            let restore_i =
                MenuItem::with_id(app, "restore", "Restore Windows", true, None::<&str>)?;
            let clear_i =
                MenuItem::with_id(app, "clear", "Clear Stored Windows", true, None::<&str>)?;
            let open_default_i =
                MenuItem::with_id(app, "open_default", "Open Default Apps", true, None::<&str>)?;
            let sep0 = PredefinedMenuItem::separator(app)?;
            let auto_i =
                MenuItem::with_id(app, "autoplacer", "Start Autoplacer", true, None::<&str>)?;
            let claude_wt_i =
                MenuItem::with_id(app, "claude_wt", "Start claude-wt", true, None::<&str>)?;
            let claude_wt_restore_i = MenuItem::with_id(
                app,
                "claude_wt_restore",
                "Restore claude sessions",
                true,
                None::<&str>,
            )?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let mqtt_status_i =
                MenuItem::with_id(app, "mqtt_status", "MQTT: stopped", false, None::<&str>)?;
            let mqtt_toggle_i =
                MenuItem::with_id(app, "mqtt_toggle", "Start MQTT", true, None::<&str>)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let restart_store_i =
                MenuItem::with_id(app, "restart_store", "Restart (Store)", true, None::<&str>)?;
            let restart_i =
                MenuItem::with_id(app, "restart", "Restart", true, None::<&str>)?;
            let sleep_i = MenuItem::with_id(app, "sleep", "Sleep", true, None::<&str>)?;
            let shutdown_i =
                MenuItem::with_id(app, "shutdown", "Shutdown", true, None::<&str>)?;
            let wallpapers_i =
                MenuItem::with_id(app, "wallpapers", "Set Wallpapers", true, None::<&str>)?;
            let sep3 = PredefinedMenuItem::separator(app)?;
            let reload_i =
                MenuItem::with_id(app, "reload", "Reload Configs", true, None::<&str>)?;
            let settings_i =
                MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
            let open_log_i =
                MenuItem::with_id(app, "open_log", "Open Log Location", true, None::<&str>)?;
            let exit_i = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[
                    &version_info_i,
                    &download_update_i,
                    &sep_update,
                    &place_i,
                    &store_i,
                    &restore_i,
                    &clear_i,
                    &open_default_i,
                    &sep0,
                    &auto_i,
                    &claude_wt_i,
                    &claude_wt_restore_i,
                    &sep1,
                    &mqtt_status_i,
                    &mqtt_toggle_i,
                    &sep2,
                    &restart_store_i,
                    &restart_i,
                    &sleep_i,
                    &shutdown_i,
                    &wallpapers_i,
                    &sep3,
                    &reload_i,
                    &settings_i,
                    &open_log_i,
                    &exit_i,
                ],
            )?;

            // Пункты, чью подпись меняют и обработчик меню, и фоновый надзор за
            // детьми, живут в состоянии приложения — иначе фоновая задача не
            // смогла бы погасить «running» у умершего процесса.
            app.manage(TrayMenuItems {
                autoplacer: auto_i.clone(),
                claude_wt: claude_wt_i.clone(),
                mqtt_status: mqtt_status_i.clone(),
                mqtt_toggle: mqtt_toggle_i.clone(),
            });
            let download_update_i_check = download_update_i.clone();

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
                    "download_update" => {
                        let state = app.state::<Mutex<AppState>>();
                        let url = state.lock().unwrap().update_download_url.clone();
                        if let Some(url) = url {
                            let _ = tauri_plugin_opener::open_url(&url, None::<&str>);
                        }
                    }
                    "place" => {
                        place_windows(app);
                    }
                    "store" => {
                        run_node_command(app, &["src/index.js", "store"], "Store Windows");
                    }
                    "restore" => {
                        run_node_command(app, &["src/index.js", "restore"], "Restore Windows");
                    }
                    "clear" => {
                        run_node_command(app, &["src/index.js", "clear"], "Clear Stored Windows");
                    }
                    "open_default" => {
                        run_node_command(app, &["src/index.js", "open-default"], "Open Default Apps");
                    }
                    "wallpapers" => {
                        run_node_command(app, &["src/index.js", "wallpapers"], "Set Wallpapers");
                    }
                    "reload" => {
                        run_node_command(app, &["src/index.js", "reload"], "Reload Configs");
                    }
                    "autoplacer" => {
                        // Подписи пунктов меняет сам toggle: они же меняются,
                        // когда ребёнок умирает без спроса.
                        let state = app.state::<Mutex<AppState>>();
                        toggle_autoplacer(app, &state);
                    }
                    "claude_wt" => {
                        let state = app.state::<Mutex<AppState>>();
                        toggle_claude_wt(app, &state);
                    }
                    "claude_wt_restore" => {
                        run_node_command(
                            app,
                            &["src/index.js", "claude-wt", "restore"],
                            "claude-wt restore",
                        );
                    }
                    "mqtt_toggle" => {
                        let state = app.state::<Mutex<AppState>>();
                        toggle_mqtt(app, &state);
                    }
                    "restart_store" => {
                        let project_path = get_project_path(app);
                        if project_path.is_empty() {
                            warn!("Project path not configured");
                            return;
                        }
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            info!("--- Restart (Store): saving positions ---");
                            info!("  project_path: {}", project_path);
                            let shell = app_handle.shell();
                            let store_result = tokio::time::timeout(
                                std::time::Duration::from_secs(15),
                                shell
                                    .command("node")
                                    .args(["src/index.js", "store"])
                                    .current_dir(&project_path)
                                    .output(),
                            )
                            .await;
                            let output = match store_result {
                                Ok(Ok(out)) => out,
                                Ok(Err(e)) => {
                                    error!("Store command error (node not running): {}", e);
                                    warn!("  Hint: ensure node is in PATH when running the app");
                                    return;
                                }
                                Err(_) => {
                                    error!("Store command timed out after 15s");
                                    return;
                                }
                            };
                            let exit_code = output.status.code().unwrap_or(-1);
                            let stdout = String::from_utf8_lossy(&output.stdout);
                            let stderr = String::from_utf8_lossy(&output.stderr);
                            if !stdout.trim().is_empty() {
                                info!("  stdout: {}", stdout.trim());
                            }
                            if !stderr.trim().is_empty() {
                                warn!("  stderr: {}", stderr.trim());
                            }
                            if !output.status.success() {
                                error!("Store failed (exit {}): check config.js and project path", exit_code);
                                return;
                            }
                            info!("Store done (exit {}), restarting...", exit_code);
                            #[cfg(windows)]
                            let shutdown_cmd = format!(
                                "{}\\System32\\shutdown.exe",
                                std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into())
                            );
                            #[cfg(not(windows))]
                            let shutdown_cmd = "shutdown".to_string();
                            let restart_result = shell
                                .command(&shutdown_cmd)
                                .args(["/r", "/t", "0"])
                                .output()
                                .await;
                            if let Err(e) = restart_result {
                                error!("Shutdown command error: {}", e);
                            }
                            app_handle.exit(0);
                        });
                    }
                    "restart" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            info!("--- Restart ---");
                            let shell = app_handle.shell();
                            #[cfg(windows)]
                            let shutdown_cmd = format!(
                                "{}\\System32\\shutdown.exe",
                                std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into())
                            );
                            #[cfg(not(windows))]
                            let shutdown_cmd = "shutdown".to_string();
                            let result = shell
                                .command(&shutdown_cmd)
                                .args(["/r", "/t", "0"])
                                .output()
                                .await;
                            if let Err(e) = result {
                                error!("Restart command error: {}", e);
                            }
                            app_handle.exit(0);
                        });
                    }
                    "sleep" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let shell = app_handle.shell();
                            #[cfg(windows)]
                            let result = shell
                                .command("rundll32.exe")
                                .args(["powrprof.dll,SetSuspendState", "0,1,0"])
                                .output()
                                .await;
                            #[cfg(not(windows))]
                            let result = shell
                                .command("systemctl")
                                .args(["suspend"])
                                .output()
                                .await;
                            if let Err(e) = result {
                                error!("Sleep command error: {}", e);
                            }
                        });
                    }
                    "shutdown" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let shell = app_handle.shell();
                            #[cfg(windows)]
                            let result = shell
                                .command("shutdown")
                                .args(["/s", "/t", "0"])
                                .output()
                                .await;
                            #[cfg(not(windows))]
                            let result = shell
                                .command("shutdown")
                                .args(["-h", "now"])
                                .output()
                                .await;
                            if let Err(e) = result {
                                error!("Shutdown command error: {}", e);
                            }
                        });
                    }
                    "settings" => {
                        open_settings_window(app);
                    }
                    "open_log" => {
                        let project_path = get_project_path(app);
                        if !project_path.is_empty() {
                            let log_dir = std::path::Path::new(&project_path)
                                .join("data");
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let shell = app_handle.shell();
                                let _ = shell
                                    .command("cmd")
                                    .args(["/c", "start", "", &log_dir.to_string_lossy()])
                                    .output()
                                    .await;
                            });
                        }
                    }
                    "exit" => {
                        info!("=== Exit requested ===");
                        // Force-exit watchdog: if graceful shutdown hangs, force terminate after 5s
                        std::thread::spawn(|| {
                            std::thread::sleep(std::time::Duration::from_secs(5));
                            error!("Force exit: graceful shutdown timed out after 5s");
                            std::process::exit(1);
                        });
                        let settings = load_settings_from_store(app);
                        let app_handle = app.clone();
                        // Kill all child processes
                        let state = app.state::<Mutex<AppState>>();
                        let mut s = state.lock().unwrap();
                        s.autoplacer_generation += 1;
                        if let Some(child) = s.autoplacer_child.take() {
                            let _ = child.kill();
                        }
                        // Именно stop_claude_wt_locked, а не kill: иначе надзор
                        // счёл бы это падением и поднял бы демона заново прямо
                        // посреди выхода из приложения.
                        stop_claude_wt_locked(&mut s);
                        stop_mqtt_state(&mut s);
                        drop(s);

                        if settings.store_before_exit {
                            let project_path = get_project_path(app);
                            if !project_path.is_empty() {
                                tauri::async_runtime::spawn(async move {
                                    info!("--- Store Windows (exit) ---");
                                    let shell = app_handle.shell();
                                    let result = tokio::time::timeout(
                                        std::time::Duration::from_secs(15),
                                        shell
                                            .command("node")
                                            .args(["src/index.js", "store"])
                                            .current_dir(&project_path)
                                            .output(),
                                    )
                                    .await;
                                    match result {
                                        Ok(Ok(out)) => {
                                            let exit_code = out.status.code().unwrap_or(-1);
                                            info!("--- Store done (exit: {}) ---", exit_code);
                                        }
                                        Ok(Err(e)) => error!("Store before exit failed: {}", e),
                                        Err(_) => error!("Store before exit timed out after 15s"),
                                    }
                                    info!("Exiting after store...");
                                    app_handle.exit(0);
                                });
                            } else {
                                info!("Exiting (no project path)...");
                                app_handle.exit(0);
                            }
                        } else {
                            info!("Exiting (store disabled)...");
                            app_handle.exit(0);
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // Retain tray reference so it persists for app lifetime
            app.manage(TrayHolder { _tray: tray });

            // Auto-start MQTT if enabled
            let settings = load_settings_from_store(app.handle());
            if settings.mqtt_enabled {
                let state = app.state::<Mutex<AppState>>();
                start_mqtt_service(app.handle(), &state);
                let running = state.lock().unwrap().mqtt_running;
                update_tray_label(app.handle(), ChildKind::Mqtt, running);
            }

            // Автостарт демона claude-wt. На нём держатся панель openHASP и
            // пикер сессий, поэтому ждать ручного тычка в трей — значит
            // молча ронять всю цепочку после каждой перезагрузки.
            if settings.claude_wt_enabled {
                let state = app.state::<Mutex<AppState>>();
                let running = {
                    let mut s = state.lock().unwrap();
                    start_claude_wt_locked(app.handle(), &mut s);
                    s.claude_wt_running
                };
                update_tray_label(app.handle(), ChildKind::ClaudeWt, running);
            }

            // Restore windows on start if enabled
            if settings.restore_on_start {
                run_node_command(app.handle(), &["src/index.js", "restore", "--verbose"], "Restore Windows (startup)");
            }

            // Spawn background task to periodically store window positions
            if settings.store_interval > 0 {
                let app_handle = app.handle().clone();
                let interval = settings.store_interval;
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(interval as u64)).await;
                        let project_path = get_project_path(&app_handle);
                        if project_path.is_empty() {
                            continue;
                        }
                        info!("--- Store Windows (periodic) ---");
                        let shell = app_handle.shell();
                        let result = shell
                            .command("node")
                            .args(["src/index.js", "store"])
                            .current_dir(&project_path)
                            .output()
                            .await;
                        match result {
                            Ok(out) => {
                                let exit_code = out.status.code().unwrap_or(-1);
                                info!("--- Store (periodic) done (exit: {}) ---", exit_code);
                            }
                            Err(e) => error!("Periodic store failed: {}", e),
                        }
                    }
                });
            }

            // Check for updates
            {
                let app_handle = app.handle().clone();
                let update_interval = settings.update_check_interval.clone();
                tauri::async_runtime::spawn(async move {
                    let store = match app_handle.store("settings.json") {
                        Ok(s) => s,
                        Err(_) => return,
                    };
                    let last_check = store
                        .get("last_update_check")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);

                    if !updater::should_check(last_check, &update_interval) {
                        info!("Skipping update check (interval: {}, last: {})", update_interval, last_check);
                        return;
                    }

                    let current_version = app_handle.package_info().version.to_string();
                    info!("Checking for updates (current: v{})...", current_version);

                    match updater::check_latest_release(&current_version).await {
                        Some(update) => {
                            let _ = download_update_i_check.set_text(format!("Download v{}", update.version));
                            let _ = download_update_i_check.set_enabled(true);
                            let state = app_handle.state::<Mutex<AppState>>();
                            state.lock().unwrap().update_download_url = Some(update.download_url);
                        }
                        None => {
                            let _ = download_update_i_check.set_text("Up to date");
                        }
                    }

                    let now = chrono::Utc::now().timestamp();
                    store.set("last_update_check", serde_json::json!(now));
                    let _ = store.save();
                });
            }

            // Register global hotkey: Ctrl+Alt+Shift+P
            use tauri_plugin_global_shortcut::ShortcutState;

            if let Err(e) = app.global_shortcut().on_shortcut(
                "Ctrl+Alt+Shift+P",
                move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        info!("Hotkey Ctrl+Alt+Shift+P pressed");
                        place_windows(app);
                    }
                },
            ) {
                warn!("Could not register hotkey Ctrl+Alt+Shift+P: {} (already in use?)", e);
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

mod children;
mod logging;
mod tray_windows;
mod updater;

use children::{next_restart_attempt, pump_output, restart_delay_secs, ChildKind};
use chrono::{Local, NaiveDate, NaiveDateTime, TimeZone};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
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
    /// Глобальный хоткей разовой расстановки окон. Пустая строка — выключен.
    pub place_hotkey: String,
    /// Глобальный хоткей плитки терминалов Claude по зонам FancyZones.
    /// Пустая строка — выключен.
    pub tile_hotkey: String,
    /// Глобальный хоткей каскада терминалов Claude. Пустая строка — выключен.
    pub cascade_hotkey: String,
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
            // Прежде расстановка висела на захардкоженном Ctrl+Alt+Shift+P, и
            // занять его не удавалось: комбинацию держало другое приложение, а
            // единственным следом была строка warn в логе.
            //
            // Alt, а не Shift, вынужденно: `Win+Ctrl+Shift+<цифра>` резервирует
            // сама оболочка Windows («новый экземпляр приложения N панели задач
            // от администратора»), и RegisterHotKey отдаёт на неё
            // ERROR_HOTKEY_ALREADY_REGISTERED при любой цифре. Проверено на
            // живой машине: Win+цифра, Win+Shift+цифра и Win+Ctrl+Shift+цифра
            // заняты все, Ctrl+Alt+Win+0 свободна.
            place_hotkey: "Ctrl+Alt+Win+0".to_string(),
            // Прямое требование человека: F10 под плитку, F11 — соседней
            // клавишей под каскад. С Win+цифрой (см. выше) конфликта нет —
            // это функциональные клавиши, а не цифровой ряд, который
            // резервирует оболочка Windows.
            tile_hotkey: "Ctrl+Win+F10".to_string(),
            cascade_hotkey: "Ctrl+Win+F11".to_string(),
        }
    }
}

/// Привести написанное человеком к тому, что понимает парсер global-hotkey.
///
/// Клавишу Windows там зовут `Super`: `WIN` не входит в список модификаторов и
/// уезжает в parse_key, где такой клавиши нет, — весь хоткей отваливается с
/// ошибкой разбора. При этом на самой Windows её никто не называет Super,
/// поэтому в настройках держим человеческое написание, а переводим здесь.
fn normalize_hotkey(raw: &str) -> String {
    raw.split('+')
        .map(|token| token.trim())
        .filter(|token| !token.is_empty())
        .map(|token| match token.to_uppercase().as_str() {
            "WIN" | "WINDOWS" | "META" => "Super",
            _ => token,
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// Найти совпадение среди трёх хоткеев настроек, если оно есть.
///
/// На Windows вторая регистрация одной и той же комбинации возвращает
/// `ERROR_HOTKEY_ALREADY_REGISTERED`: код тихо пишет `warn!` в лог и не
/// регистрирует её — человек видит только то, что одна из клавиш «не
/// работает», а причину находит лишь в логе. Сравнение идёт после
/// `normalize_hotkey` и без учёта регистра: она переводит `Win` в `Super`, но
/// не трогает регистр остальных токенов, а `Ctrl+Win+F10` и `ctrl+win+f10` —
/// одна и та же комбинация для RegisterHotKey. Пустые (выключенные) хоткеи не
/// считаются совпадением.
/// Разложить нормализованный хоткей на «множество модификаторов + клавиша».
///
/// Для `RegisterHotKey` модификаторы — битовая маска, а не позиция в строке:
/// `Ctrl+Alt+Win+0` и `Alt+Ctrl+Win+0` — одна и та же комбинация, но
/// склеенные нормализованные строки этого не видят (сравнение "склеенная
/// строка == склеенная строка" ловит только точное совпадение порядка
/// токенов). Регистр тоже не важен для регистрации — приводится здесь же.
/// `None` — выключенный (пустой) хоткей.
fn hotkey_signature(raw: &str) -> Option<(std::collections::BTreeSet<String>, String)> {
    let normalized = normalize_hotkey(raw);
    if normalized.is_empty() {
        return None;
    }
    let mut tokens: Vec<String> = normalized
        .split('+')
        .map(|t| t.trim().to_ascii_lowercase())
        .filter(|t| !t.is_empty())
        .collect();
    let key = tokens.pop()?;
    Some((tokens.into_iter().collect(), key))
}

fn hotkey_collision_warning(settings: &Settings) -> Option<String> {
    let entries = [
        ("Place windows", &settings.place_hotkey),
        ("Place Claude: tile", &settings.tile_hotkey),
        ("Place Claude: cascade", &settings.cascade_hotkey),
    ];
    for i in 0..entries.len() {
        let (name_a, raw_a) = entries[i];
        let Some(sig_a) = hotkey_signature(raw_a) else {
            continue;
        };
        for entry_b in entries.iter().skip(i + 1) {
            let (name_b, raw_b) = *entry_b;
            let Some(sig_b) = hotkey_signature(raw_b) else {
                continue;
            };
            if sig_a == sig_b {
                return Some(format!(
                    "Сохранено, но «{}» и «{}» используют одну комбинацию ({}) — сработает только одна",
                    name_a, name_b, normalize_hotkey(raw_a)
                ));
            }
        }
    }
    None
}

/// Время сборки этого бинаря, если оно в него вшито.
///
/// `None` у релизной сборки: её называет версия, а штамп там лишний. Ноль в
/// штампе значит именно это — см. `build.rs`.
fn build_time() -> Option<NaiveDateTime> {
    let secs: i64 = env!("WM_BUILD_UNIX").parse().ok()?;
    if secs == 0 {
        return None;
    }
    Some(Local.timestamp_opt(secs, 0).single()?.naive_local())
}

/// Подпись неактивного пункта меню: какая сборка сейчас запущена.
///
/// Нужна она после выкатки: `deploy-pc.sh` обновляет менеджер на месте, версия
/// у всех сборок между релизами одна, и «то ли перезапустилось» иначе не
/// проверить ничем.
///
/// Дата опускается, когда сборка сегодняшняя, — чаще всего так и есть, а
/// повторять сегодняшнее число в трее незачем. «Сегодня» считается от запуска
/// менеджера, а не от открытия меню: меню строится один раз при старте, и у
/// процесса, прожившего в трее сутки, подпись устареет — покажет время без даты
/// у вчерашней сборки. Цена известна и принята: менеджер, проживший сутки,
/// перезапускали не сегодня, и вопрос «то ли собралось» к нему не стоит.
/// Слова `Current:` в подписи нет намеренно: пункт неактивен и стоит первым,
/// другой версии рядом не показано, и различать ему нечего. Вид один на три
/// репозитория — тот же, что у пикера и мак-менеджера, — чтобы прочитанное в
/// одном трее читалось и в остальных.
fn version_item_label(version: &str, built: Option<NaiveDateTime>, today: NaiveDate) -> String {
    let Some(built) = built else {
        return format!("v{version}");
    };
    if built.date() == today {
        format!("v{version} · {}", built.format("%H:%M"))
    } else {
        format!("v{version} · {}", built.format("%Y-%m-%d %H:%M"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Дату у сегодняшней сборки не пишем: она повторяла бы сегодняшнее число.
    #[test]
    fn today_build_shows_only_the_time() {
        let built = NaiveDate::from_ymd_opt(2026, 8, 16)
            .unwrap()
            .and_hms_opt(5, 29, 0)
            .unwrap();
        let label = version_item_label("2.1.0", Some(built), built.date());
        assert_eq!(label, "v2.1.0 · 05:29", "подпись: {label}");
    }

    /// А у вчерашней — пишем: без неё «05:29» читалось бы как сегодняшнее время,
    /// и выкатка выглядела бы удавшейся, когда перезапустилось прежнее.
    #[test]
    fn older_build_shows_the_date_too() {
        let built = NaiveDate::from_ymd_opt(2026, 8, 15)
            .unwrap()
            .and_hms_opt(23, 5, 0)
            .unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 8, 16).unwrap();
        let label = version_item_label("2.1.0", Some(built), today);
        assert_eq!(label, "v2.1.0 · 2026-08-15 23:05", "подпись: {label}");
    }

    /// Релизную сборку называет версия, и штампа ей не достаётся вовсе.
    #[test]
    fn release_build_shows_the_version_alone() {
        assert_eq!(
            version_item_label("2.1.0", None, NaiveDate::from_ymd_opt(2026, 8, 16).unwrap()),
            "v2.1.0"
        );
    }

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
        assert_eq!(s.place_hotkey, "Ctrl+Alt+Win+0");
        assert_eq!(s.tile_hotkey, "Ctrl+Win+F10");
        assert_eq!(s.cascade_hotkey, "Ctrl+Win+F11");
    }

    #[test]
    fn normalize_hotkey_translates_windows_key() {
        assert_eq!(normalize_hotkey("Ctrl+Win+Shift+0"), "Ctrl+Super+Shift+0");
        assert_eq!(normalize_hotkey("ctrl+win+shift+0"), "ctrl+Super+shift+0");
        assert_eq!(normalize_hotkey("Ctrl+Windows+P"), "Ctrl+Super+P");
        assert_eq!(normalize_hotkey("Ctrl+Meta+P"), "Ctrl+Super+P");
    }

    /// Проверка строки на строку доказывает только замену подстроки. Настоящее
    /// требование — чтобы результат приняла та библиотека, которой его отдают:
    /// список её модификаторов закрытый, и опечатка в названии видна лишь при
    /// разборе. Умолчание разбирается здесь, а не на живой машине.
    #[test]
    fn normalized_default_hotkey_parses() {
        use std::str::FromStr;
        use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

        let normalized = normalize_hotkey(&Settings::default().place_hotkey);
        let parsed = Shortcut::from_str(&normalized).expect("умолчание должно разбираться");
        assert_eq!(parsed.key, Code::Digit0);
        assert_eq!(
            parsed.mods,
            Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER
        );

        // Прежнее захардкоженное значение — чтобы его можно было вернуть в поле
        // настройки и оно осталось рабочим.
        assert!(Shortcut::from_str(&normalize_hotkey("Ctrl+Alt+Shift+P")).is_ok());
        // А без перевода Win парсер именно отказывает — ради этого перевод и есть.
        assert!(Shortcut::from_str("Ctrl+Win+Shift+0").is_err());
    }

    /// Та же проверка на живой библиотеке для двух новых умолчаний — F10 и
    /// F11 под раскладки терминалов Claude.
    #[test]
    fn normalized_default_tile_and_cascade_hotkeys_parse() {
        use std::str::FromStr;
        use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

        let defaults = Settings::default();

        let tile = Shortcut::from_str(&normalize_hotkey(&defaults.tile_hotkey))
            .expect("умолчание tile_hotkey должно разбираться");
        assert_eq!(tile.key, Code::F10);
        assert_eq!(tile.mods, Modifiers::CONTROL | Modifiers::SUPER);

        let cascade = Shortcut::from_str(&normalize_hotkey(&defaults.cascade_hotkey))
            .expect("умолчание cascade_hotkey должно разбираться");
        assert_eq!(cascade.key, Code::F11);
        assert_eq!(cascade.mods, Modifiers::CONTROL | Modifiers::SUPER);
    }

    #[test]
    fn normalize_hotkey_leaves_other_tokens_alone() {
        // Ровно то, что было захардкожено до появления настройки.
        assert_eq!(normalize_hotkey("Ctrl+Alt+Shift+P"), "Ctrl+Alt+Shift+P");
        // Клавиша с "win" внутри имени — не модификатор, трогать нельзя.
        assert_eq!(normalize_hotkey("Ctrl+Window"), "Ctrl+Window");
    }

    #[test]
    fn hotkey_collision_warning_none_for_defaults() {
        // Умолчания разведены нарочно (Alt+Ctrl+Win+0 против Ctrl+Win+F10/F11) —
        // совпадения быть не должно.
        assert!(hotkey_collision_warning(&Settings::default()).is_none());
    }

    #[test]
    fn hotkey_collision_warning_catches_exact_match() {
        let mut s = Settings::default();
        s.cascade_hotkey = s.tile_hotkey.clone();
        let warning = hotkey_collision_warning(&s).expect("совпадение должно найтись");
        assert!(warning.contains("Place Claude: tile"));
        assert!(warning.contains("Place Claude: cascade"));
    }

    /// Требование из ревью: `Ctrl+Win+F10` и `ctrl+win+f10` — одна и та же
    /// комбинация, сравнение сырых строк её не поймало бы.
    #[test]
    fn hotkey_collision_warning_ignores_case() {
        let mut s = Settings::default();
        s.tile_hotkey = "Ctrl+Win+F10".to_string();
        s.place_hotkey = "ctrl+win+f10".to_string();
        assert!(hotkey_collision_warning(&s).is_some());
    }

    /// Модификаторы для RegisterHotKey — битовая маска, а не последовательность:
    /// перестановка не меняет комбинацию, а склеенные строки различались бы.
    #[test]
    fn hotkey_collision_warning_ignores_modifier_order() {
        let mut s = Settings::default();
        s.place_hotkey = "Ctrl+Alt+Win+0".to_string();
        s.tile_hotkey = "Alt+Ctrl+Win+0".to_string();
        let warning = hotkey_collision_warning(&s).expect("перестановка модификаторов — та же комбинация");
        assert!(warning.contains("Place windows"));
        assert!(warning.contains("Place Claude: tile"));
    }

    #[test]
    fn hotkey_collision_warning_ignores_disabled_hotkeys() {
        let mut s = Settings::default();
        s.place_hotkey = String::new();
        s.tile_hotkey = String::new();
        s.cascade_hotkey = String::new();
        assert!(hotkey_collision_warning(&s).is_none());
    }

    #[test]
    fn normalize_hotkey_trims_and_drops_empty_tokens() {
        assert_eq!(normalize_hotkey(" Ctrl + Win + 0 "), "Ctrl+Super+0");
        // Пустая строка — выключенный хоткей, а не ошибка разбора.
        assert_eq!(normalize_hotkey(""), "");
        assert_eq!(normalize_hotkey("  "), "");
        // Лишний плюс не должен превращаться в пустой токен: парсер на нём
        // возвращает EmptyToken и хоткей не регистрируется вовсе.
        assert_eq!(normalize_hotkey("Ctrl++0"), "Ctrl+0");
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

/// Часть меню, занятая списком отслеживаемых окон.
///
/// Длина списка меняется вместе с числом открытых сессий, а `set_text` умеет
/// только переписать готовый пункт — поэтому строки вставляются в меню и
/// убираются из него на ходу (`Menu::insert`/`Menu::remove`). Само меню лежит
/// здесь же: без него фоновой задаче не во что вставлять.
struct TrackedTray {
    menu: Menu<tauri::Wry>,
    /// Строка-итог над списком. Она в меню постоянно и только переписывается.
    count: MenuItem<tauri::Wry>,
    /// Строки, вставленные в меню прямо сейчас, — их же и убирать.
    rows: Mutex<Vec<MenuItem<tauri::Wry>>>,
    /// Позиция первой строки списка, посчитанная при сборке меню.
    base: usize,
    /// Путь к файлу окон надо спросить у node заново: конфиг перечитали.
    path_dirty: AtomicBool,
}

/// Как часто перечитывается файл окон.
///
/// Демон пишет его своим тактом (секунда), так что чаще смысла нет, а реже —
/// заметно глазом: человек открывает трей сразу после того, как запустил
/// сессию. Само чтение стоит одного `read_to_string` небольшого файла, и на
/// такте ничего не происходит, пока содержимое не изменилось.
const TRACKED_TICK_SECS: u64 = 3;

/// Через сколько тактов повторять попытку узнать путь к файлу окон.
///
/// Спрашивается он у node запуском процесса, и на машине без настроенного
/// `claudeWt.windowsFile` эта попытка не удастся никогда — дёргать node каждые
/// три секунды до конца дней ради заведомого отказа незачем.
const TRACKED_PATH_RETRY_TICKS: u32 = 100;

/// Спросить у node путь к файлу окон. YAML-конфиг Rust не разбирает.
async fn resolve_windows_path(app: &tauri::AppHandle) -> Option<String> {
    let project_path = get_project_path(app);
    if project_path.is_empty() {
        return None;
    }
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        app.shell()
            .command("node")
            .args(["src/index.js", "claude-wt", "windows-path"])
            .current_dir(&project_path)
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        // Не error: пустой `claudeWt.windowsFile` — законная настройка машины,
        // которая ничего никуда не публикует, и ошибкой в логе она не является.
        warn!(
            "claude-wt windows-path: {}",
            describe_node_failure(&output)
        );
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!path.is_empty()).then_some(path)
}

/// Переписать список окон в меню.
///
/// Зовётся только когда вид изменился: перевставлять те же пункты каждые три
/// секунды значило бы разбирать и собирать меню под открытым курсором.
fn apply_tracked_windows(app: &tauri::AppHandle, view: &tray_windows::TrayWindows) {
    let Some(tray) = app.try_state::<TrackedTray>() else {
        return;
    };
    let _ = tray.count.set_text(&view.count_label);
    let Ok(mut rows) = tray.rows.lock() else {
        return;
    };
    for item in rows.drain(..) {
        let _ = tray.menu.remove(&item);
    }
    for (i, label) in view.rows.iter().enumerate() {
        // Пункты неактивные: это подписи, а не действия. Поднять окно отсюда
        // было бы можно, но поднимает их служба MQTT и по своим правилам —
        // второй, тихо расходящийся с ней путь заводить не за чем.
        match MenuItem::with_id(app, format!("tracked_{i}"), label, false, None::<&str>) {
            Ok(item) => {
                if let Err(e) = tray.menu.insert(&item, tray.base + i) {
                    warn!("Failed to insert tracked window item: {}", e);
                    continue;
                }
                rows.push(item);
            }
            Err(e) => warn!("Failed to create tracked window item: {}", e),
        }
    }
}

/// Следить за файлом окон и держать список в меню в согласии с ним.
fn spawn_tracked_windows_watch(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut path: Option<String> = None;
        let mut retry_in: u32 = 0;
        let mut shown: Option<tray_windows::TrayWindows> = None;
        // Имя машины спрашивается один раз: оно не меняется, пока приложение
        // живо. На не-Windows переменной нет — тогда чужой файл отличить
        // нечем, и проверка не делается вовсе.
        let local_host = std::env::var("COMPUTERNAME").ok();
        loop {
            if app
                .try_state::<TrackedTray>()
                .map(|t| t.path_dirty.swap(false, Ordering::Relaxed))
                .unwrap_or(false)
            {
                path = None;
                retry_in = 0;
            }
            if path.is_none() {
                if retry_in == 0 {
                    path = resolve_windows_path(&app).await;
                    if path.is_none() {
                        retry_in = TRACKED_PATH_RETRY_TICKS;
                    }
                } else {
                    retry_in -= 1;
                }
            }
            let raw = path.as_ref().and_then(|p| std::fs::read_to_string(p).ok());
            let view = tray_windows::tray_windows(
                raw.as_deref(),
                local_host.as_deref(),
                Local::now().timestamp(),
            );
            if shown.as_ref() != Some(&view) {
                apply_tracked_windows(&app, &view);
                shown = Some(view);
            }
            tokio::time::sleep(std::time::Duration::from_secs(TRACKED_TICK_SECS)).await;
        }
    });
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
        place_hotkey: store
            .get("place_hotkey")
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or(defaults.place_hotkey),
        tile_hotkey: store
            .get("tile_hotkey")
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or(defaults.tile_hotkey),
        cascade_hotkey: store
            .get("cascade_hotkey")
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or(defaults.cascade_hotkey),
    };

    Ok(settings)
}

/// Строка версии для окна настроек — ровно та же, что и у неактивного пункта
/// меню трея (`version_info`): одна функция форматирования, два вызывающих,
/// чтобы окно настроек не завело свой формат и не разошлось с треем.
#[tauri::command]
async fn get_app_version(app: tauri::AppHandle) -> Result<String, String> {
    let version = app.package_info().version.to_string();
    Ok(version_item_label(&version, build_time(), Local::now().date_naive()))
}

/// Хвост лога для вкладки Log в окне настроек.
///
/// Пункт «Open Log Location» рядом открывает тот же файл в проводнике, и одно
/// другого не отменяет: посмотреть последние строки, не выходя из настроек,
/// нужно чаще, чем разбирать лог целиком.
///
/// Отсутствие файла — не отказ: приложение только что запустили с пустым
/// `project_path`, писать было некуда, и показывать по этому поводу ошибку
/// вместо пустой вкладки незачем.
#[tauri::command]
async fn read_log(app: tauri::AppHandle) -> Result<String, String> {
    let project_path = get_project_path(&app);
    if project_path.is_empty() {
        return Err("Project path not configured".to_string());
    }
    let path = logging::log_path(&project_path);
    match logging::read_tail(&path, logging::LOG_TAIL_BYTES, logging::LOG_TAIL_LINES) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("{}: {}", path.display(), e)),
    }
}

/// Сохранить настройки. `Ok` несёт предупреждение о совпавших хоткеях, если
/// оно есть (иначе — пустую строку): сохранение не запрещается совпадением —
/// человек мог сделать это намеренно и поправит следующим шагом, но окно
/// настроек обязано сказать об этом сразу, а не оставить искать причину в
/// логе.
#[tauri::command]
async fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<String, String> {
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

    // Прежнее значение читаем до записи: по нему снимается старая регистрация.
    // Без снятия обе комбинации остались бы рабочими до перезапуска, а человек
    // видел бы в настройках только новую.
    let previous_hotkey = store
        .get("place_hotkey")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| Settings::default().place_hotkey);
    store.set("place_hotkey", serde_json::json!(settings.place_hotkey));

    let previous_tile_hotkey = store
        .get("tile_hotkey")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| Settings::default().tile_hotkey);
    store.set("tile_hotkey", serde_json::json!(settings.tile_hotkey));

    let previous_cascade_hotkey = store
        .get("cascade_hotkey")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| Settings::default().cascade_hotkey);
    store.set("cascade_hotkey", serde_json::json!(settings.cascade_hotkey));

    store.save().map_err(|e| e.to_string())?;

    if normalize_hotkey(&previous_hotkey) != normalize_hotkey(&settings.place_hotkey) {
        unregister_place_hotkey(&app, &previous_hotkey);
        register_place_hotkey(&app, &settings.place_hotkey);
    }
    if normalize_hotkey(&previous_tile_hotkey) != normalize_hotkey(&settings.tile_hotkey) {
        unregister_tile_hotkey(&app, &previous_tile_hotkey);
        register_tile_hotkey(&app, &settings.tile_hotkey);
    }
    if normalize_hotkey(&previous_cascade_hotkey) != normalize_hotkey(&settings.cascade_hotkey) {
        unregister_cascade_hotkey(&app, &previous_cascade_hotkey);
        register_cascade_hotkey(&app, &settings.cascade_hotkey);
    }

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

    Ok(hotkey_collision_warning(&settings).unwrap_or_default())
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

/// Сообщение об отказе node-команды: сначала stderr, а если он пуст (процесс
/// убит, не написал ни слова и просто вышел с ненулевым кодом) — код
/// возврата, а не пустая строка после префикса вроде «Tile zones: » в
/// статусе окна настроек.
fn describe_node_failure(output: &tauri_plugin_shell::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }
    match output.status.code() {
        Some(code) => format!("команда узла завершилась с кодом {code}, без сообщения в stderr"),
        None => "команда узла прервана сигналом, без сообщения в stderr".to_string(),
    }
}

/// Прочитать `claudeWt.tileZones` из живого YAML-конфига node-части.
///
/// Трей хранилище YAML не разбирает вовсе — ни зависимости, ни кода для
/// этого нет, — поэтому чтение и запись идут через node-команду
/// `claude-wt tile-zones`, тем же приёмом, что `get_dashboard_data`.
#[tauri::command]
async fn get_tile_zones(app: tauri::AppHandle) -> Result<String, String> {
    let project_path = get_project_path(&app);
    if project_path.is_empty() {
        return Err("Project path not configured".to_string());
    }

    let shell = app.shell();
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        shell
            .command("node")
            .args(["src/index.js", "claude-wt", "tile-zones", "get"])
            .current_dir(&project_path)
            .output(),
    )
    .await
    .map_err(|_| "tile-zones get timed out after 10s".to_string())?
    .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!("tile-zones get failed: {}", describe_node_failure(&output)));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Записать `claudeWt.tileZones` в живой YAML-конфиг node-части.
///
/// Разбор и точечная правка (сохраняющая комментарии конфига) — целиком на
/// стороне node; здесь только передача текста поля и прогон ошибки разбора
/// (неразборчивая строка) человеку в статус окна настроек, а не в лог.
#[tauri::command]
async fn save_tile_zones(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let project_path = get_project_path(&app);
    if project_path.is_empty() {
        return Err("Project path not configured".to_string());
    }

    let shell = app.shell();
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        shell
            .command("node")
            .args(["src/index.js", "claude-wt", "tile-zones", "set"])
            .arg(&text)
            .current_dir(&project_path)
            .output(),
    )
    .await
    .map_err(|_| "tile-zones set timed out after 10s".to_string())?
    .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(describe_node_failure(&output));
    }

    Ok(())
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
        place_hotkey: store.get("place_hotkey").and_then(|v| v.as_str().map(String::from)).unwrap_or(defaults.place_hotkey),
        tile_hotkey: store.get("tile_hotkey").and_then(|v| v.as_str().map(String::from)).unwrap_or(defaults.tile_hotkey),
        cascade_hotkey: store.get("cascade_hotkey").and_then(|v| v.as_str().map(String::from)).unwrap_or(defaults.cascade_hotkey),
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

/// Плитка терминалов Claude по зонам FancyZones. Тот же приём, что у соседа
/// по меню `claude_wt_restore` — голый `run_node_command` без проверки
/// project_path, потому что расстановка Claude без него всё равно ничего не
/// сделает и сама пожалуется в лог.
fn place_claude_tile(app: &tauri::AppHandle) {
    run_node_command(
        app,
        &["src/index.js", "claude-wt", "place", "tile"],
        "Place Claude: tile",
    );
}

/// Каскад терминалов Claude. См. `place_claude_tile`.
fn place_claude_cascade(app: &tauri::AppHandle) {
    run_node_command(
        app,
        &["src/index.js", "claude-wt", "place", "cascade"],
        "Place Claude: cascade",
    );
}

/// Повесить разовую расстановку окон на глобальный хоткей.
///
/// Отказ регистрации — не повод падать: комбинацию мог занять кто угодно
/// другой, и приложение в этом случае продолжает работать, просто без хоткея.
/// Раньше единственным следом такого отказа была строка warn, и найти её мог
/// только тот, кто уже знал, что искать; теперь комбинацию видно и в
/// настройках, так что её можно сменить, не пересобирая приложение.
fn register_place_hotkey(app: &tauri::AppHandle, raw: &str) {
    use tauri_plugin_global_shortcut::ShortcutState;

    let shortcut = normalize_hotkey(raw);
    if shortcut.is_empty() {
        info!("Place hotkey is empty — not registering");
        return;
    }

    let label = shortcut.clone();
    if let Err(e) = app
        .global_shortcut()
        .on_shortcut(shortcut.as_str(), move |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                info!("Hotkey {} pressed", label);
                place_windows(app);
            }
        })
    {
        warn!("Could not register hotkey {}: {} (already in use?)", shortcut, e);
    } else {
        info!("Place hotkey registered: {}", shortcut);
    }
}

/// Снять регистрацию прежней комбинации при смене настройки.
fn unregister_place_hotkey(app: &tauri::AppHandle, raw: &str) {
    let shortcut = normalize_hotkey(raw);
    if shortcut.is_empty() {
        return;
    }
    // Ошибка здесь ожидаема ровно в одном случае: прежнюю комбинацию так и не
    // удалось занять при старте. Снимать нечего — это не повод шуметь ошибкой.
    if let Err(e) = app.global_shortcut().unregister(shortcut.as_str()) {
        info!("Place hotkey {} was not registered: {}", shortcut, e);
    }
}

/// Повесить плитку Claude на глобальный хоткей. Тот же приём и те же
/// оговорки, что у `register_place_hotkey`.
fn register_tile_hotkey(app: &tauri::AppHandle, raw: &str) {
    use tauri_plugin_global_shortcut::ShortcutState;

    let shortcut = normalize_hotkey(raw);
    if shortcut.is_empty() {
        info!("Tile hotkey is empty — not registering");
        return;
    }

    let label = shortcut.clone();
    if let Err(e) = app
        .global_shortcut()
        .on_shortcut(shortcut.as_str(), move |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                info!("Hotkey {} pressed", label);
                place_claude_tile(app);
            }
        })
    {
        warn!("Could not register hotkey {}: {} (already in use?)", shortcut, e);
    } else {
        info!("Tile hotkey registered: {}", shortcut);
    }
}

/// Снять регистрацию прежней комбинации плитки Claude при смене настройки.
fn unregister_tile_hotkey(app: &tauri::AppHandle, raw: &str) {
    let shortcut = normalize_hotkey(raw);
    if shortcut.is_empty() {
        return;
    }
    if let Err(e) = app.global_shortcut().unregister(shortcut.as_str()) {
        info!("Tile hotkey {} was not registered: {}", shortcut, e);
    }
}

/// Повесить каскад Claude на глобальный хоткей. Тот же приём и те же
/// оговорки, что у `register_place_hotkey`.
fn register_cascade_hotkey(app: &tauri::AppHandle, raw: &str) {
    use tauri_plugin_global_shortcut::ShortcutState;

    let shortcut = normalize_hotkey(raw);
    if shortcut.is_empty() {
        info!("Cascade hotkey is empty — not registering");
        return;
    }

    let label = shortcut.clone();
    if let Err(e) = app
        .global_shortcut()
        .on_shortcut(shortcut.as_str(), move |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                info!("Hotkey {} pressed", label);
                place_claude_cascade(app);
            }
        })
    {
        warn!("Could not register hotkey {}: {} (already in use?)", shortcut, e);
    } else {
        info!("Cascade hotkey registered: {}", shortcut);
    }
}

/// Снять регистрацию прежней комбинации каскада Claude при смене настройки.
fn unregister_cascade_hotkey(app: &tauri::AppHandle, raw: &str) {
    let shortcut = normalize_hotkey(raw);
    if shortcut.is_empty() {
        return;
    }
    if let Err(e) = app.global_shortcut().unregister(shortcut.as_str()) {
        info!("Cascade hotkey {} was not registered: {}", shortcut, e);
    }
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
    let stopped = app_state.claude_wt_running;
    if stopped {
        stop_claude_wt_locked(&mut app_state);
    } else {
        start_claude_wt_locked(app, &mut app_state);
    }
    let running = app_state.claude_wt_running;
    drop(app_state);

    if stopped {
        // Демона снимают жёстко (TerminateProcess), поэтому убрать за собой
        // опубликованный файл окон он не успевает — а в файле лежит его pid, по
        // которому сторож в MQTT-службе снимает замолчавшего демона. Служба
        // остановку из трея переживает, и полторы минуты спустя файл ещё
        // считался бы свежим: ровно одно снятие могло уйти в чужой процесс,
        // которому Windows уже отдала освободившийся номер. Убираем файл
        // отдельным запуском node — путь к нему знает только конфиг проекта.
        run_node_command(
            app,
            &["src/index.js", "claude-wt", "windows-clear"],
            "Clear claude-wt windows file",
        );
    }

    update_tray_label(app, ChildKind::ClaudeWt, running);
    let _ = app.emit("claude-wt-toggled", running);
}

/// Всё, что нужно для запуска службы, собранное до взятия мьютекса.
///
/// Ходит в хранилище настроек и — если пути проекта нет — открывает окно
/// настроек. Второе и есть причина, по которой сбор вынесен наружу: webview
/// строится только на главном потоке, и вызов из фоновой задачи ждёт, пока тот
/// освободится. Главный поток в этот момент вполне может стоять в обработчике
/// трея на мьютексе `AppState` — тогда фоновая задача держит мьютекс и ждёт
/// главный поток, а главный поток ждёт мьютекс. Под замком не должно
/// происходить ничего, что трогает UI.
fn mqtt_launch_config(app: &tauri::AppHandle) -> Option<(Settings, String)> {
    let settings = load_settings_from_store(app);
    if settings.mqtt_host.is_empty() || settings.mqtt_topic.is_empty() {
        warn!("MQTT host or topic not configured");
        return None;
    }

    let project_path = get_project_path(app);
    if project_path.is_empty() {
        warn!("Project path not configured, opening settings");
        open_settings_window(app);
        return None;
    }

    Some((settings, project_path))
}

fn start_mqtt_service(app: &tauri::AppHandle, state: &State<'_, Mutex<AppState>>) {
    let Some((settings, project_path)) = mqtt_launch_config(app) else {
        return;
    };
    let mut app_state = state.lock().unwrap();
    start_mqtt_locked(app, &mut app_state, settings, project_path);
}

/// Подъём службы MQTT через `delay_secs`. Как и у демона, перед подъёмом ещё раз
/// спрашивает состояние: за время паузы оператор мог и выключить службу из трея,
/// и поднять её руками.
fn schedule_mqtt_restart(app: &tauri::AppHandle, delay_secs: u64) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(delay_secs)).await;
        {
            let state = app.state::<Mutex<AppState>>();
            let s = state.lock().unwrap();
            if !s.mqtt_desired || s.mqtt_running {
                return;
            }
        }
        // Настройки спрашиваем с отпущенным мьютексом (см. mqtt_launch_config) и
        // уже после проверки «служба ещё нужна»: иначе выключенная из трея
        // служба открывала бы человеку окно настроек через минуту после
        // выключения.
        let Some((settings, project_path)) = mqtt_launch_config(&app) else {
            return;
        };
        let running = {
            let state = app.state::<Mutex<AppState>>();
            let mut s = state.lock().unwrap();
            if !s.mqtt_desired {
                return;
            }
            // Между проверкой и этим местом службу могли поднять руками — от
            // второго ребёнка спасает запрет внутри start_mqtt_locked.
            start_mqtt_locked(&app, &mut s, settings, project_path);
            s.mqtt_running
        };
        update_tray_label(&app, ChildKind::Mqtt, running);
    });
}

/// Запуск службы MQTT при уже взятом мьютексе. Настройки и путь проекта берутся
/// готовыми (`mqtt_launch_config`): здесь, под замком, ходить за ними нельзя.
///
/// Как и у демона claude-wt, неудача самого `spawn` (нет node в PATH, кривой
/// путь проекта) считается попыткой: следующая уезжает по откату, иначе цикл
/// «не смог запустить → пробуем снова» крутился бы без паузы.
fn start_mqtt_locked(
    app: &tauri::AppHandle,
    s: &mut AppState,
    settings: Settings,
    project_path: String,
) {
    // Второй такой же ребёнок хуже, чем ни одного: два процесса пишут одни и те
    // же retained-топики Home Assistant, каждый со своим порядком слотов, и
    // каждый заводит своего сторожа демона. Ручка при этом теряется —
    // `mqtt_child` переписывается вторым, и на выходе из приложения убьют
    // только его, а первый останется висеть. Запрет стоит здесь, а не у
    // вызывающих: их трое, и мьютекс каждый берёт по-своему.
    if s.mqtt_running {
        warn!("MQTT service already running, not starting a second one");
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
    // Настройки собираются до мьютекса — и потому, что под замком нельзя
    // трогать UI, и потому, что решение «стоп или старт» обязано приниматься
    // под тем же замком, под которым потом действуют. Прежний код читал
    // `mqtt_running` под одним замком, а запускал под другим: в промежутке
    // помещался подъём из фоновой задачи, и служба поднималась дважды.
    let launch = mqtt_launch_config(app);

    let mut app_state = state.lock().unwrap();
    if app_state.mqtt_running {
        stop_mqtt_state(&mut app_state);
    } else if let Some((settings, project_path)) = launch {
        start_mqtt_locked(app, &mut app_state, settings, project_path);
    }
    let running = app_state.mqtt_running;
    drop(app_state);

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
        .invoke_handler(tauri::generate_handler![get_settings, save_settings, get_dashboard_data, get_app_version, read_log, save_store_match_list, get_tile_zones, save_tile_zones])
        .setup(|app| {
            let project_path = get_project_path(app.handle());
            logging::init(&project_path);

            // Build tray menu
            let current_version = app.package_info().version.to_string();
            let version_info_i = MenuItem::with_id(
                app,
                "version_info",
                version_item_label(
                    &current_version,
                    build_time(),
                    Local::now().date_naive(),
                ),
                false,
                None::<&str>,
            )?;
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
            // Плитка и каскад для терминалов Claude. Знак перед подписью — тот
            // же приём, что на маке (macos-windows-manager): символ без
            // цветного Emoji_Presentation сам берёт цвет и размер у шрифта
            // меню, растра под каждую тему и масштаб экрана не требуется.
            // После знака — один волосяной пробел (U+200A) как разделитель;
            // ширины под шрифт меню Windows никто не мерил, точную подгонку
            // здесь не изображаем — в отличие от мака, где количество таких
            // пробелов подобрано по замерам в системном шрифте.
            let claude_wt_place_tile_i = MenuItem::with_id(
                app,
                "claude_wt_place_tile",
                "\u{25a6}\u{200a}Place Claude: tile",
                true,
                None::<&str>,
            )?;
            let claude_wt_place_cascade_i = MenuItem::with_id(
                app,
                "claude_wt_place_cascade",
                "\u{2750}\u{200a}Place Claude: cascade",
                true,
                None::<&str>,
            )?;
            // Строка-итог стоит прямо под пунктом демона: она рассказывает
            // именно про него, и читается так же, как «MQTT: running» ниже про
            // свою службу. Подпись, а не действие — как и строки окон под ней.
            let tracked_count_i = MenuItem::with_id(
                app,
                "tracked_count",
                tray_windows::INITIAL_COUNT_LABEL,
                false,
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

            // Список меню разрезан надвое ровно там, куда фоновая задача
            // вставляет подписи отслеживаемых окон: позиция вставки считается
            // длиной первой половины, а не написана числом. Число разъехалось
            // бы с меню от любого нового пункта выше — и подписи полезли бы в
            // середину чужой группы.
            let before_tracked: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = vec![
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
                &tracked_count_i,
                &claude_wt_restore_i,
                &claude_wt_place_tile_i,
                &claude_wt_place_cascade_i,
            ];
            let tracked_base = before_tracked.len();
            let after_tracked: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = vec![
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
            ];
            let menu = Menu::with_items(
                app,
                &[before_tracked, after_tracked].concat(),
            )?;

            // Пункты, чью подпись меняют и обработчик меню, и фоновый надзор за
            // детьми, живут в состоянии приложения — иначе фоновая задача не
            // смогла бы погасить «running» у умершего процесса.
            app.manage(TrackedTray {
                menu: menu.clone(),
                count: tracked_count_i.clone(),
                rows: Mutex::new(Vec::new()),
                base: tracked_base,
                path_dirty: AtomicBool::new(false),
            });
            spawn_tracked_windows_watch(app.handle());

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
                        // Путь к файлу окон живёт в том же перечитанном
                        // конфиге: без этого список отслеживаемых окон остался
                        // бы смотреть на прежний файл до перезапуска.
                        if let Some(tray) = app.try_state::<TrackedTray>() {
                            tray.path_dirty.store(true, Ordering::Relaxed);
                        }
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
                    "claude_wt_place_tile" => {
                        place_claude_tile(app);
                    }
                    "claude_wt_place_cascade" => {
                        place_claude_cascade(app);
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
                                error!("Store failed (exit {}): check config.yaml and project path", exit_code);
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

            register_place_hotkey(app.handle(), &settings.place_hotkey);
            register_tile_hotkey(app.handle(), &settings.tile_hotkey);
            register_cascade_hotkey(app.handle(), &settings.cascade_hotkey);

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

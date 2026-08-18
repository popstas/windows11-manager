//! Список отслеживаемых окон claude-wt для меню трея.
//!
//! Данные готовы задолго до этого модуля: демон каждый свой тик публикует файл
//! окон (`claudeWt.windowsFile`, см. `src/claude-wt/windows-file-helpers.js`),
//! и здесь он только читается. Путь к файлу спрашивается у node
//! (`claude-wt windows-path`) — YAML-конфиг Rust не разбирает, ровно как и в
//! случае с `tileZones`.
//!
//! Всё, что можно посчитать без диска, вынесено в чистые функции: подписи,
//! обрезка, отбор по свежести и хозяину файла. Тот же приём, что у node-части
//! проекта (`*-helpers.js`) — и по той же причине: проверять это на живой
//! Windows-машине дорого, а ошибиться тут легко.

use serde::Deserialize;
use std::collections::HashMap;

/// Сколько окон показываем строками. Остальные сворачиваются в «…and N more»:
/// меню трея растёт вниз от значка, и полтора десятка сессий увели бы нижние
/// пункты (Exit в том числе) за край экрана.
pub const MAX_ROWS: usize = 12;

/// Длина подписи в символах, после которой заголовок обрезается. Меню
/// растягивается по самому длинному пункту, и одно окно с длинным заголовком
/// увело бы весь остальной трей под курсор через пол-экрана.
pub const MAX_LABEL_CHARS: usize = 44;

/// Насколько старым может быть файл, чтобы его данным ещё верили.
///
/// Демон переписывает файл не реже чем раз в 30 секунд даже когда ничего не
/// менялось (`WINDOWS_FILE_HEARTBEAT_MS`), и `generated` — единственный признак
/// его живости: mtime не отличает «демон умер» от «расклад не менялся». Три
/// сердцебиения запаса — чтобы список не мигал из-за одного пропущенного тика
/// на сетевом диске.
pub const MAX_AGE_SECS: i64 = 90;

/// Подпись строки-итога до первого чтения файла. Она же и после него, пока
/// файла нет: свежесобранное меню не должно обещать список, которого может и
/// не оказаться.
pub const INITIAL_COUNT_LABEL: &str = "claude-wt: no data";

/// Файл окон в том виде, в каком его пишет демон. Читаются только поля, нужные
/// меню: снимки, хоткеи проектов и координаты едут там же, но трею не нужны.
#[derive(Debug, Deserialize)]
pub struct WindowsFile {
    #[serde(default)]
    pub host: String,
    /// Секунды эпохи, не миллисекунды — так пишет `buildWindowsFile`.
    #[serde(default)]
    pub generated: i64,
    #[serde(default)]
    pub windows: HashMap<String, TrackedWindow>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TrackedWindow {
    #[serde(default)]
    pub title: String,
    /// Как зовут терминал. Рядом живут Windows Terminal и WezTerm, и заголовок
    /// сессии сам по себе не говорит, в котором из них она открыта.
    #[serde(default)]
    pub app: String,
}

/// То, что показывает меню: строка-итог и подписи окон под ней.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayWindows {
    pub count_label: String,
    pub rows: Vec<String>,
}

/// Обрезка по символам, а не по байтам: в заголовках сессий бывает кириллица,
/// и обрезка по байтам разваливала бы её посреди символа.
fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let head: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{}\u{2026}", head.trim_end())
}

/// Подпись одного окна: `заголовок · терминал`.
///
/// Терминал не обрезается вместе с заголовком: имена у них короткие, а
/// отвечает эта половина как раз на вопрос «в котором окне искать».
pub fn window_label(title: &str, app: &str) -> String {
    let title = title.trim();
    let app = app.trim();
    let title = if title.is_empty() { "(no title)" } else { title };
    let title = truncate(title, MAX_LABEL_CHARS);
    if app.is_empty() {
        title
    } else {
        format!("{title} \u{b7} {app}")
    }
}

/// Строка-итог над списком.
pub fn count_label(n: usize) -> String {
    match n {
        0 => "no windows tracked".to_string(),
        1 => "1 window tracked".to_string(),
        n => format!("{n} windows tracked"),
    }
}

/// Пустой вид с объяснением вместо счётчика.
fn no_data(reason: &str) -> TrayWindows {
    TrayWindows {
        count_label: format!("claude-wt: {reason}"),
        rows: Vec::new(),
    }
}

/// Разобрать файл окон в то, что показывает меню.
///
/// `raw` — содержимое файла либо `None`, когда файла нет или он не читается:
/// это не поломка, а обычное состояние остановленного демона (он убирает файл
/// за собой), и жаловаться в лог тут не на что.
///
/// `local_host` — имя этой машины либо `None`, когда его не удалось узнать.
/// Файл может лежать на общем диске, и чужие окна поднимать здесь нечем; но
/// неизвестное своё имя — не повод отвергать файл, иначе список пропадал бы
/// именно там, где проверить нечем.
pub fn tray_windows(raw: Option<&str>, local_host: Option<&str>, now_secs: i64) -> TrayWindows {
    let Some(raw) = raw else {
        return no_data("no data");
    };
    let Ok(file) = serde_json::from_str::<WindowsFile>(raw) else {
        return no_data("unreadable file");
    };
    if now_secs - file.generated > MAX_AGE_SECS {
        return no_data("no data");
    }
    if let Some(local) = local_host {
        if !file.host.is_empty() && !file.host.eq_ignore_ascii_case(local) {
            return no_data(&format!("file of {}", file.host));
        }
    }

    // Порядок — по подписи, а не по идентификатору сессии: тот случайный и
    // менялся бы от такта к такту, стоит одному окну закрыться. Сравнение без
    // учёта регистра, иначе `Zed` встал бы перед `claude-wt`.
    let mut labels: Vec<String> = file
        .windows
        .values()
        .map(|w| window_label(&w.title, &w.app))
        .collect();
    labels.sort_by_key(|l| l.to_lowercase());

    let total = labels.len();
    let mut rows: Vec<String> = labels.into_iter().take(MAX_ROWS).collect();
    if total > MAX_ROWS {
        rows.push(format!("\u{2026}and {} more", total - MAX_ROWS));
    }
    TrayWindows {
        count_label: count_label(total),
        rows,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(host: &str, generated: i64, windows: &[(&str, &str, &str)]) -> String {
        let body: Vec<String> = windows
            .iter()
            .map(|(id, title, app)| {
                format!(r#""{id}":{{"title":"{title}","app":"{app}","desktop":0}}"#)
            })
            .collect();
        format!(
            r#"{{"host":"{host}","pid":1,"generated":{generated},"windows":{{{}}}}}"#,
            body.join(",")
        )
    }

    /// Файл читается не из этого модуля, а пишется в node
    /// (`buildWindowsFile`), и разъехаться две стороны могут молча: лишние
    /// поля `serde` пропускает, пропавшее `app` подставилось бы пустым, и
    /// список в трее просто обеднел бы, ничего не сказав. Образец снят с
    /// живого `buildWindowsFile` — пересоздать его командой из этого теста.
    ///
    ///   node --input-type=module -e "import { buildWindowsFile } from
    ///   './src/claude-wt/windows-file-helpers.js'; …" > tests/fixtures/windows-file.json
    #[test]
    fn parses_a_file_written_by_the_node_daemon() {
        let raw = include_str!("../tests/fixtures/windows-file.json");
        let view = tray_windows(Some(raw), Some("POPSTAS-PC"), 1_700_000_000);
        assert_eq!(view.count_label, "2 windows tracked");
        assert_eq!(
            view.rows,
            vec![
                "ccfzf-picker \u{b7} WezTerm",
                "claude-wt \u{b7} WindowsTerminal",
            ]
        );
    }

    #[test]
    fn lists_windows_sorted_by_label() {
        let raw = payload(
            "PC",
            1000,
            &[
                ("a", "zed", "WezTerm"),
                ("b", "Ccfzf", "WezTerm"),
                ("c", "claude-wt", "WindowsTerminal"),
            ],
        );
        let view = tray_windows(Some(&raw), Some("PC"), 1000);
        assert_eq!(view.count_label, "3 windows tracked");
        assert_eq!(
            view.rows,
            vec![
                "Ccfzf \u{b7} WezTerm",
                "claude-wt \u{b7} WindowsTerminal",
                "zed \u{b7} WezTerm",
            ]
        );
    }

    #[test]
    fn one_window_is_singular_and_none_is_plural() {
        let raw = payload("PC", 1000, &[("a", "solo", "WezTerm")]);
        assert_eq!(
            tray_windows(Some(&raw), Some("PC"), 1000).count_label,
            "1 window tracked"
        );
        let empty = payload("PC", 1000, &[]);
        let view = tray_windows(Some(&empty), Some("PC"), 1000);
        assert_eq!(view.count_label, "no windows tracked");
        assert!(view.rows.is_empty());
    }

    #[test]
    fn missing_and_unreadable_files_show_no_data() {
        assert_eq!(tray_windows(None, Some("PC"), 1000), no_data("no data"));
        // Подпись пункта до первого чтения — та же, иначе свежесобранное меню
        // мигало бы другой строкой на первом же такте.
        assert_eq!(
            tray_windows(None, Some("PC"), 1000).count_label,
            INITIAL_COUNT_LABEL
        );
        assert_eq!(
            tray_windows(Some("not json at all"), Some("PC"), 1000),
            no_data("unreadable file")
        );
    }

    #[test]
    fn stale_file_is_dropped() {
        let raw = payload("PC", 1000, &[("a", "solo", "WezTerm")]);
        // Ровно на границе файлу ещё верят, на секунду позже — уже нет.
        assert_eq!(tray_windows(Some(&raw), Some("PC"), 1000 + MAX_AGE_SECS).rows.len(), 1);
        assert_eq!(
            tray_windows(Some(&raw), Some("PC"), 1001 + MAX_AGE_SECS),
            no_data("no data")
        );
    }

    #[test]
    fn file_of_another_machine_is_named_not_shown() {
        let raw = payload("OTHER-PC", 1000, &[("a", "solo", "WezTerm")]);
        assert_eq!(
            tray_windows(Some(&raw), Some("PC"), 1000),
            no_data("file of OTHER-PC")
        );
        // Регистр имени машины не считается расхождением: `os.hostname()` на
        // Windows отдаёт его не тем же регистром, что `COMPUTERNAME`.
        assert_eq!(tray_windows(Some(&raw), Some("other-pc"), 1000).rows.len(), 1);
        // Своего имени не знаем — верим файлу, иначе список пропал бы там, где
        // проверить нечем.
        assert_eq!(tray_windows(Some(&raw), None, 1000).rows.len(), 1);
    }

    #[test]
    fn long_titles_are_truncated_and_extra_rows_collapse() {
        let long = "a".repeat(80);
        let label = window_label(&long, "WezTerm");
        assert!(label.starts_with(&"a".repeat(MAX_LABEL_CHARS - 1)));
        assert!(label.ends_with("\u{2026} \u{b7} WezTerm"));

        let many: Vec<(String, String, String)> = (0..MAX_ROWS + 3)
            .map(|i| (format!("s{i}"), format!("win{i:02}"), "WezTerm".to_string()))
            .collect();
        let refs: Vec<(&str, &str, &str)> = many
            .iter()
            .map(|(a, b, c)| (a.as_str(), b.as_str(), c.as_str()))
            .collect();
        let view = tray_windows(Some(&payload("PC", 1000, &refs)), Some("PC"), 1000);
        assert_eq!(view.count_label, format!("{} windows tracked", MAX_ROWS + 3));
        assert_eq!(view.rows.len(), MAX_ROWS + 1);
        assert_eq!(view.rows.last().unwrap(), "\u{2026}and 3 more");
    }

    #[test]
    fn window_without_title_or_app_still_gets_a_label() {
        assert_eq!(window_label("", "WezTerm"), "(no title) \u{b7} WezTerm");
        assert_eq!(window_label("solo", ""), "solo");
    }

    /// Кириллица режется по символам: обрезка по байтам разваливала бы её
    /// посреди символа, и подпись стала бы негодной.
    #[test]
    fn truncation_counts_characters_not_bytes() {
        let title = "п".repeat(60);
        let label = window_label(&title, "");
        assert_eq!(label.chars().count(), MAX_LABEL_CHARS);
    }
}

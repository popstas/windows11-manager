//! Связь службы с брокером — для пункта меню, подсказки и метки на значке.
//!
//! «Service: running» говорит только, что жив процесс node: клиент MQTT в нём
//! может раз в пять секунд получать «not authorized», и трей этого не видел.
//! Служба пишет переходы связи служебной строкой в stdout (`src/mqtt/link.js`),
//! `pump_output` отдаёт такие строки сюда, а не в лог.

use serde::Deserialize;

/// Начало служебной строки. Пара — `LINK_MARKER` в `src/mqtt/link.js`.
pub const LINK_MARKER: &str = "@@w11m-link ";

#[derive(Clone, Debug, PartialEq)]
pub enum Link {
    /// Служба не запущена (остановлена из трея или выключена в настройках).
    Stopped,
    /// Брокер не настроен — служба работает только по http. Метки нет.
    Off,
    Connecting,
    Connected,
    /// Связи нет, в строке — почему.
    Down(String),
}

#[derive(Deserialize)]
struct Wire {
    state: String,
    #[serde(default)]
    reason: String,
}

/// Служебная строка → состояние. `None` — строка не наша или испорчена: тогда
/// она уходит в лог как обычный вывод.
pub fn parse_line(line: &str) -> Option<Link> {
    let json = line.trim().strip_prefix(LINK_MARKER)?;
    let wire: Wire = serde_json::from_str(json).ok()?;
    Some(match wire.state.as_str() {
        "off" => Link::Off,
        "connecting" => Link::Connecting,
        "connected" => Link::Connected,
        "disconnected" => Link::Down(if wire.reason.is_empty() {
            "unknown error".to_string()
        } else {
            wire.reason
        }),
        _ => return None,
    })
}

impl Link {
    pub fn menu_label(&self) -> String {
        match self {
            Link::Stopped => "MQTT: service stopped".to_string(),
            Link::Off => "MQTT: not configured".to_string(),
            Link::Connecting => "MQTT: connecting…".to_string(),
            Link::Connected => "MQTT: connected".to_string(),
            Link::Down(reason) => format!("MQTT: disconnected — {reason}"),
        }
    }

    pub fn tooltip(&self) -> String {
        match self {
            Link::Down(reason) => format!("windows11-manager — MQTT disconnected: {reason}"),
            _ => "windows11-manager".to_string(),
        }
    }

    /// Метка — только у обрыва. Остановленная из трея служба — воля
    /// человека, а не поломка; упавшая и поднимаемая заново приходит сюда
    /// как `Down` (см. `on_child_exit`).
    pub fn badged(&self) -> bool {
        matches!(self, Link::Down(_))
    }
}

/// Значок с меткой обрыва: красная точка в правом нижнем углу, обведённая
/// прозрачным кольцом — оно отделяет красное от глифа значка.
///
/// Размеры — доли стороны: значок приложения бывает и 32, и 256 пикселей, и
/// точка в пикселях на одном из них потерялась бы. Та же картинка в пикере
/// (`mqtt_status::badge` в ccfzf-picker) — метки двух треев читаются одинаково.
pub fn badge(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let mut out = rgba.to_vec();
    let side = width.min(height) as f32;
    let dot = side * 0.25;
    let ring = dot + (side / 16.0).max(1.0);
    let cx = width as f32 - dot;
    let cy = height as f32 - dot;
    for y in 0..height {
        for x in 0..width {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            let d = (dx * dx + dy * dy).sqrt();
            let i = ((y * width + x) * 4) as usize;
            if d <= dot {
                out[i..i + 4].copy_from_slice(&[0xE5, 0x39, 0x35, 0xFF]);
            } else if d <= ring {
                out[i + 3] = 0;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_every_state_of_the_service() {
        assert_eq!(parse_line(r#"@@w11m-link {"state":"connected"}"#), Some(Link::Connected));
        assert_eq!(parse_line(r#"@@w11m-link {"state":"connecting"}"#), Some(Link::Connecting));
        assert_eq!(parse_line(r#"@@w11m-link {"state":"off"}"#), Some(Link::Off));
        assert_eq!(
            parse_line(r#"@@w11m-link {"state":"disconnected","reason":"not authorized"}"#),
            Some(Link::Down("not authorized".into()))
        );
    }

    #[test]
    fn line_ending_from_windows_does_not_break_it() {
        assert_eq!(parse_line("@@w11m-link {\"state\":\"connected\"}\r\n"), Some(Link::Connected));
    }

    #[test]
    fn ordinary_output_is_not_a_state() {
        assert_eq!(parse_line("[mqtt] MQTT connected to mqtt://broker.example:1883"), None);
        assert_eq!(parse_line("@@w11m-link not json"), None);
        assert_eq!(parse_line(r#"@@w11m-link {"state":"weird"}"#), None);
    }

    #[test]
    fn only_a_broken_link_gets_the_badge() {
        assert!(Link::Down("timeout".into()).badged());
        assert!(!Link::Connected.badged());
        assert!(!Link::Stopped.badged());
        assert!(!Link::Off.badged());
    }

    #[test]
    fn menu_names_the_reason() {
        assert_eq!(
            Link::Down("not authorized".into()).menu_label(),
            "MQTT: disconnected — not authorized"
        );
        assert!(Link::Down("timeout".into()).tooltip().contains("timeout"));
        assert_eq!(Link::Connected.tooltip(), "windows11-manager");
    }

    fn pixel(rgba: &[u8], side: u32, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * side + x) * 4) as usize;
        [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
    }

    #[test]
    fn badge_puts_a_red_dot_with_a_ring_in_the_corner() {
        let side = 32;
        let out = badge(&vec![0xFF; (side * side * 4) as usize], side, side);
        assert_eq!(pixel(&out, side, 24, 24), [0xE5, 0x39, 0x35, 0xFF]);
        assert!((0..side).any(|x| pixel(&out, side, x, 24)[3] == 0), "кольца нет");
        assert_eq!(pixel(&out, side, 4, 4), [0xFF; 4]);
    }
}

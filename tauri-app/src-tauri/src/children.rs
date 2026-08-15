//! Надзор за node-детьми, которых поднимает трей.
//!
//! Раньше приёмник событий у `spawn()` просто выбрасывался: вывод ребёнка не
//! попадал никуда, а о его смерти никто не узнавал — трей продолжал писать
//! «running» над давно умершим процессом. Здесь живёт всё, что нужно, чтобы
//! этого не повторилось: перекачка потока событий в общий лог и правила
//! отката для перезапуска.

use log::{error, info, warn};
use tauri::async_runtime::Receiver;
use tauri_plugin_shell::process::CommandEvent;

/// Первая пауза перед подъёмом. Секунды, а не мгновенно: процесс, упавший из-за
/// незавершённого `npm install`, упадёт и через 2 секунды, и лог не захлебнётся.
pub const RESTART_BASE_SECS: u64 = 2;
/// Потолок паузы. Дальше удваивать бессмысленно: минута — это и не спам в логе,
/// и не «демон вернётся к вечеру».
pub const RESTART_MAX_SECS: u64 = 60;
/// Сколько ребёнок должен прожить, чтобы попытку считать удачной и сбросить
/// откат. Иначе после суток работы одиночное падение уезжало бы сразу в минуту.
pub const HEALTHY_UPTIME_SECS: u64 = 60;

/// Кто именно из детей. Ярлык один и тот же и в логе, и в пунктах трея, чтобы
/// строку из лога можно было соотнести с тем, что видит оператор.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChildKind {
    Autoplacer,
    ClaudeWt,
    Mqtt,
}

impl ChildKind {
    pub fn label(self) -> &'static str {
        match self {
            ChildKind::Autoplacer => "autoplacer",
            ChildKind::ClaudeWt => "claude-wt",
            ChildKind::Mqtt => "mqtt",
        }
    }
}

/// Номер попытки для следующего подъёма.
///
/// Долгая жизнь предыдущего процесса означает, что запуск как таковой рабочий,
/// и упал он по другой причине — счётчик сбрасывается в единицу. Короткая — это
/// та же самая неустранимая поломка, и пауза растёт.
pub fn next_restart_attempt(prev_attempt: u32, uptime_secs: u64) -> u32 {
    if uptime_secs >= HEALTHY_UPTIME_SECS {
        1
    } else {
        prev_attempt.saturating_add(1)
    }
}

/// Пауза перед попыткой номер `attempt` (первая попытка — 1).
///
/// Удвоение от [`RESTART_BASE_SECS`] до потолка [`RESTART_MAX_SECS`]. Сдвиг
/// ограничен вручную: без ограничения `1 << 64` — это паника в debug и мусор
/// в release, то есть счётчик попыток стал бы способом уронить приложение.
pub fn restart_delay_secs(attempt: u32) -> u64 {
    let steps = attempt.saturating_sub(1).min(16);
    RESTART_BASE_SECS
        .saturating_mul(1u64 << steps)
        .min(RESTART_MAX_SECS)
}

/// Человекочитаемая причина смерти для строки лога.
///
/// Код возврата тут не украшение: «exited with code 1» отличает пятиминутный
/// разбор от часа поисков в MQTT.
pub fn exit_description(code: Option<i32>, signal: Option<i32>) -> String {
    match (code, signal) {
        (Some(code), _) => format!("code {}", code),
        (None, Some(signal)) => format!("signal {}", signal),
        (None, None) => "unknown code".to_string(),
    }
}

fn log_output(label: &str, bytes: &[u8], is_err: bool) {
    let text = String::from_utf8_lossy(bytes);
    let line = text.trim_end_matches(['\r', '\n']);
    if line.is_empty() {
        return;
    }
    if is_err {
        warn!("[{}] {}", label, line);
    } else {
        info!("[{}] {}", label, line);
    }
}

/// Вычитывает поток событий ребёнка до конца: stdout и stderr уходят в общий
/// лог, а `on_exit` зовётся ровно один раз, когда процесса больше нет.
///
/// Приёмник нельзя просто уронить: у `tauri-plugin-shell` на той стороне
/// пишущий поток, и брошенный приёмник — это и потерянный вывод, и потерянное
/// событие `Terminated`, из-за которого статус в трее врёт.
///
/// `on_exit` вызывается и тогда, когда `Terminated` не пришёл вовсе (канал
/// закрылся молча): для надзора «процесса нет» важнее, чем «известен код».
pub fn pump_output<F>(kind: ChildKind, mut rx: Receiver<CommandEvent>, on_exit: F)
where
    F: FnOnce(String, u64) + Send + 'static,
{
    let label = kind.label();
    tauri::async_runtime::spawn(async move {
        let started = std::time::Instant::now();
        let mut exit: Option<String> = None;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => log_output(label, &bytes, false),
                CommandEvent::Stderr(bytes) => log_output(label, &bytes, true),
                CommandEvent::Error(e) => error!("[{}] stream error: {}", label, e),
                CommandEvent::Terminated(payload) => {
                    exit = Some(exit_description(payload.code, payload.signal));
                }
                _ => {}
            }
        }
        let uptime = started.elapsed().as_secs();
        on_exit(
            exit.unwrap_or_else(|| "unknown code (stream closed)".to_string()),
            uptime,
        );
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delay_grows_and_stops_at_ceiling() {
        assert_eq!(restart_delay_secs(1), 2);
        assert_eq!(restart_delay_secs(2), 4);
        assert_eq!(restart_delay_secs(3), 8);
        assert_eq!(restart_delay_secs(4), 16);
        assert_eq!(restart_delay_secs(5), 32);
        assert_eq!(restart_delay_secs(6), RESTART_MAX_SECS);
        assert_eq!(restart_delay_secs(50), RESTART_MAX_SECS);
        // Большой счётчик не должен переполнять сдвиг.
        assert_eq!(restart_delay_secs(u32::MAX), RESTART_MAX_SECS);
    }

    #[test]
    fn attempt_grows_while_child_dies_fast() {
        assert_eq!(next_restart_attempt(0, 0), 1);
        assert_eq!(next_restart_attempt(1, 1), 2);
        assert_eq!(next_restart_attempt(2, 59), 3);
    }

    #[test]
    fn attempt_resets_after_healthy_run() {
        assert_eq!(next_restart_attempt(5, HEALTHY_UPTIME_SECS), 1);
        assert_eq!(next_restart_attempt(5, 3600), 1);
    }

    #[test]
    fn exit_description_prefers_code() {
        assert_eq!(exit_description(Some(1), None), "code 1");
        assert_eq!(exit_description(Some(0), Some(9)), "code 0");
        assert_eq!(exit_description(None, Some(9)), "signal 9");
        assert_eq!(exit_description(None, None), "unknown code");
    }

    #[test]
    fn labels_are_stable() {
        assert_eq!(ChildKind::Mqtt.label(), "mqtt");
        assert_eq!(ChildKind::ClaudeWt.label(), "claude-wt");
        assert_eq!(ChildKind::Autoplacer.label(), "autoplacer");
    }
}

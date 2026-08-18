use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Куда пишется лог. Одно место на всех: писать сюда и читать отсюда должны по
/// одному и тому же имени, а вкладка Log в настройках как раз читает.
pub fn log_path(project_path: &str) -> PathBuf {
    Path::new(project_path)
        .join("data")
        .join("windows11-manager.log")
}

/// Сколько байт с конца файла поднимаем с диска.
///
/// Файл не ротируется и за месяц дорастает до мегабайтов, а вкладка Log
/// перечитывает его раз в две секунды, пока открыта, — читать его целиком
/// значило бы гонять весь лог через диск каждые две секунды ради последних
/// полусотни строк.
pub const LOG_TAIL_BYTES: u64 = 256 * 1024;

/// Сколько строк показывает вкладка Log.
pub const LOG_TAIL_LINES: usize = 500;

/// Последние `max_lines` строк текста.
pub fn tail_lines(text: &str, max_lines: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n")
}

/// Хвост файла: последние `max_lines` строк из последних `max_bytes` байт.
///
/// Читается кусок с конца, а не файл целиком (см. [`LOG_TAIL_BYTES`]). Первая
/// строка куска почти наверняка разрезана посередине — и выбрасывается, если
/// читали не с начала файла: показывать половину записи хуже, чем не
/// показывать её вовсе. Байты, не сложившиеся в UTF-8 (тем же разрезом), едут
/// заменой, а не отказом: одна битая буква не повод не показать лог.
pub fn read_tail(path: &Path, max_bytes: u64, max_lines: usize) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;

    let text = String::from_utf8_lossy(&buf);
    let text = if start > 0 {
        match text.find('\n') {
            Some(i) => &text[i + 1..],
            None => "",
        }
    } else {
        &text
    };
    Ok(tail_lines(text, max_lines))
}

pub fn init(project_path: &str) {
    let mut dispatch = fern::Dispatch::new()
        .format(|out, message, record| {
            out.finish(format_args!(
                "[{}][{}] {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                record.level(),
                message
            ))
        })
        .level(log::LevelFilter::Info)
        .chain(std::io::stdout());

    if !project_path.is_empty() {
        let data_dir = Path::new(project_path).join("data");
        if let Err(e) = fs::create_dir_all(&data_dir) {
            eprintln!("Failed to create data dir {:?}: {}", data_dir, e);
        } else {
            let log_file = log_path(project_path);
            match fern::log_file(&log_file) {
                Ok(file) => {
                    dispatch = dispatch.chain(file);
                }
                Err(e) => {
                    eprintln!("Failed to open log file {:?}: {}", log_file, e);
                }
            }
        }
    }

    if let Err(e) = dispatch.apply() {
        eprintln!("Failed to initialize logging: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_temp(name: &str, body: &[u8]) -> PathBuf {
        let path = std::env::temp_dir().join(name);
        fs::write(&path, body).unwrap();
        path
    }

    #[test]
    fn tail_keeps_the_last_lines() {
        let text = "one\ntwo\nthree\nfour";
        assert_eq!(tail_lines(text, 2), "three\nfour");
        assert_eq!(tail_lines(text, 99), text);
        assert_eq!(tail_lines("", 5), "");
    }

    #[test]
    fn short_file_is_read_whole() {
        let path = write_temp("w11m-log-short.log", b"a\nb\nc\n");
        assert_eq!(read_tail(&path, LOG_TAIL_BYTES, 10).unwrap(), "a\nb\nc");
    }

    /// Кусок с конца начинается посреди строки, и эту половину надо выбросить:
    /// полузапись в логе читается как испорченная запись, а не как обрезка.
    #[test]
    fn partial_first_line_is_dropped() {
        let path = write_temp("w11m-log-cut.log", b"first line\nsecond\nthird\n");
        // 12 байт с конца — это «cond\nthird\n» с огрызком предыдущей строки.
        assert_eq!(read_tail(&path, 12, 10).unwrap(), "third");
    }

    #[test]
    fn missing_file_is_an_error_for_the_caller_to_soften() {
        let path = std::env::temp_dir().join("w11m-log-not-here.log");
        let _ = fs::remove_file(&path);
        let err = read_tail(&path, LOG_TAIL_BYTES, 10).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
    }

    /// Разрез приходится на середину многобайтового символа — читать всё равно
    /// надо: лог с кириллицей иначе не показался бы вовсе.
    #[test]
    fn broken_utf8_at_the_cut_does_not_fail() {
        // 15 байт с конца: разрез приходится на второй байт «а» в «строка»,
        // и обрубок уезжает вместе со всей своей строкой.
        let path = write_temp("w11m-log-utf8.log", "строка\nвторая\n".as_bytes());
        assert_eq!(read_tail(&path, 15, 10).unwrap(), "вторая");
    }

    #[test]
    fn log_path_sits_next_to_the_rest_of_the_data() {
        assert!(log_path("C:/w11m")
            .to_string_lossy()
            .ends_with("windows11-manager.log"));
    }
}

use std::fs;
use std::path::Path;

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
            let log_file = data_dir.join("windows11-manager.log");
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

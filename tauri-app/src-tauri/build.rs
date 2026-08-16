use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    // Штамп времени сборки виден в пункте меню трея. Нужен он затем, что
    // `deploy-pc.sh` обновляет менеджер на месте: после выкатки нечем
    // проверить, что перезапустилось именно новое, — версия у всех сборок
    // между релизами одна.
    //
    // Признак «это релиз» объявляет сборщик переменной окружения, а не
    // cargo-профиль: выкатка собирает `--release`, и на `debug_assertions`
    // штамп пропал бы ровно там, где он и нужен. Выставляет её `release.yml`
    // на сборке под тегом — у выпущенной версии есть номер, и штамп там лишний.
    println!("cargo:rerun-if-env-changed=WM_RELEASE");
    // Без явного rerun-if-changed штамп застыл бы на первой сборке: любой
    // `cargo:rerun-if-*` отменяет умолчание «пересобирать скрипт на любую
    // правку в пакете», а его отменяет уже `tauri_build::build()` своими
    // директивами.
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=Cargo.toml");
    // Фронтенд — тоже вход сборки, но каталог его лежит вне пакета
    // (`frontendDist` — `../src`), и сам себя он здесь не объявляет:
    // `tauri_build::build()` печатает директиву только на `tauri.conf.json` и
    // `capabilities`, а статику вшивает `generate_context!` уже на компиляции.
    // Без этой строки выкатка с одними правками страницы оставляла бы скрипт
    // свежим, и штамп в трее показывал бы прошлую сборку — ровно то, за чем в
    // него и смотрят после деплоя. В соседнем ccfzf-picker за эту строку уже
    // заплачено расследованием.
    println!("cargo:rerun-if-changed=../src");
    let stamp = if std::env::var_os("WM_RELEASE").is_some() {
        0
    } else {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    };
    println!("cargo:rustc-env=WM_BUILD_UNIX={stamp}");
    tauri_build::build()
}
